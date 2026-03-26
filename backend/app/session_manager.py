"""
Session Manager — Gère les sessions GDB actives.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

from .gdb_bridge import GdbBridge
from .models import AssembleResponse
from .sandbox import apply_sandbox_limits, build_gdb_command

log = logging.getLogger("asmble.sessions")


# Assembleurs supportés
ASSEMBLERS: dict[str, dict] = {
    "nasm": {
        "cmd": ["nasm", "-f", "elf64", "-g", "-F", "dwarf", "{src}", "-o", "{obj}"],
        "link": ["ld", "-m", "elf_x86_64", "{obj}", "-o", "{bin}"],
        "ext": ".asm",
    },
    "gas": {
        "cmd": ["as", "--gstabs+", "--64", "-o", "{obj}", "{src}"],
        "link": ["ld", "-m", "elf_x86_64", "{obj}", "-o", "{bin}"],
        "ext": ".s",
    },
    "fasm": {
        "cmd": ["fasm", "{src}", "{bin}"],
        "link": None,
        "ext": ".asm",
    },
    "yasm": {
        "cmd": ["yasm", "-f", "elf64", "-g", "dwarf2", "{src}", "-o", "{obj}"],
        "link": ["ld", "-m", "elf_x86_64", "{obj}", "-o", "{bin}"],
        "ext": ".asm",
    },
}

# Methods delegated from Session to GdbBridge via __getattr__
_BRIDGE_METHODS = frozenset({
    "step", "step_over", "step_out", "step_back", "continue_exec",
    "read_state", "add_breakpoint", "remove_breakpoint",
    "add_watchpoint", "remove_watchpoint", "read_memory",
    "evaluate", "set_register", "set_args", "gdb_command",
    "read_section_data",
})


class Session:
    """Une session = un workspace tmpfs + un processus GDB."""

    def __init__(self, session_id: str, workdir: Path):
        self.id = session_id
        self.workdir = workdir
        self.bridge: GdbBridge | None = None
        self.last_code: str = ""
        self.last_flavor: str = "nasm"
        self.last_activity: float = time.monotonic()

    def touch(self) -> None:
        """Update last activity timestamp."""
        self.last_activity = time.monotonic()

    @property
    def binary_path(self) -> str:
        return str(self.workdir / "binary")

    @property
    def inferior_pid(self) -> int | None:
        if self.bridge and self.bridge.gdb:
            try:
                resp = self.bridge._write("-list-thread-groups")
                for r in resp:
                    if r.get("type") == "result" and r.get("payload"):
                        groups = r["payload"].get("groups", [])
                        if groups and "pid" in groups[0]:
                            return int(groups[0]["pid"])
            except Exception:
                pass
        return None

    def __getattr__(self, name: str) -> Any:
        if name in _BRIDGE_METHODS:
            if self.bridge is None:
                raise AssertionError("Debug session not started")
            return getattr(self.bridge, name)
        raise AttributeError(f"'{type(self).__name__}' has no attribute '{name}'")

    def _assemble_sync(self, code: str, flavor: str) -> AssembleResponse:
        """Assemble le code source dans le workspace temporaire (blocking)."""
        config = ASSEMBLERS.get(flavor)
        if not config:
            return AssembleResponse(success=False, errors=[f"Unknown assembler: {flavor}"])

        src_path = self.workdir / f"source{config['ext']}"
        obj_path = self.workdir / "source.o"
        bin_path = self.workdir / "binary"

        src_path.write_text(code)
        self.last_code = code
        self.last_flavor = flavor

        asm_cmd = [
            s.format(src=str(src_path), obj=str(obj_path), bin=str(bin_path))
            for s in config["cmd"]
        ]
        result = subprocess.run(
            asm_cmd, capture_output=True, text=True, timeout=10,
            preexec_fn=apply_sandbox_limits,
        )
        if result.returncode != 0:
            return AssembleResponse(
                success=False,
                errors=result.stderr.strip().splitlines(),
            )

        if config["link"]:
            link_cmd = [
                s.format(obj=str(obj_path), bin=str(bin_path))
                for s in config["link"]
            ]
            result = subprocess.run(
                link_cmd, capture_output=True, text=True, timeout=10,
                preexec_fn=apply_sandbox_limits,
            )
            if result.returncode != 0:
                return AssembleResponse(
                    success=False,
                    errors=result.stderr.strip().splitlines(),
                )

        lines = code.count("\n") + 1
        binary_size = bin_path.stat().st_size if bin_path.exists() else 0

        return AssembleResponse(
            success=True,
            lines=lines,
            binary_size=binary_size,
            session_id=self.id,
        )

    def start_debug(self) -> None:
        """Lance GDB sur le binaire assemblé (sandboxé via nsjail si disponible)."""
        bin_path = self.workdir / "binary"
        gdb_cmd = build_gdb_command(str(bin_path), str(self.workdir))
        self.bridge = GdbBridge(str(bin_path), gdb_command=gdb_cmd)
        self.bridge.start()

    def cleanup(self) -> None:
        if self.bridge:
            self.bridge.cleanup()
        if self.workdir.exists():
            shutil.rmtree(self.workdir, ignore_errors=True)


class SessionManager:
    def __init__(self, max_sessions: int = 10):
        self.sessions: dict[str, Session] = {}
        self.max_sessions = max_sessions

    @property
    def active_count(self) -> int:
        return len(self.sessions)

    async def create_session(self, code: str, flavor: str = "nasm") -> tuple[Session, AssembleResponse]:
        if len(self.sessions) >= self.max_sessions:
            oldest_id = next(iter(self.sessions))
            log.info("Max sessions reached — evicting %s", oldest_id)
            await self.destroy_session(oldest_id)

        session_id = uuid.uuid4().hex[:12]
        workdir = Path(tempfile.mkdtemp(prefix="asm-", dir="/tmp"))

        session = Session(session_id, workdir)
        result = await asyncio.to_thread(session._assemble_sync, code, flavor)

        if result.success:
            await asyncio.to_thread(session.start_debug)
            self.sessions[session_id] = session
            log.info("Session %s created (%d/%d)", session_id, self.active_count, self.max_sessions)
        else:
            session.cleanup()
            log.warning("Session %s assembly failed", session_id)

        return session, result

    async def destroy_session(self, session_id: str) -> None:
        session = self.sessions.pop(session_id, None)
        if session:
            session.cleanup()
            log.info("Session %s destroyed (%d/%d)", session_id, self.active_count, self.max_sessions)

    async def cleanup_stale(self, max_idle_secs: int = 600) -> int:
        """Remove sessions idle for more than max_idle_secs. Returns count removed."""
        now = time.monotonic()
        stale = [sid for sid, s in self.sessions.items()
                 if now - s.last_activity > max_idle_secs]
        for sid in stale:
            log.info("Auto-cleanup stale session %s (idle >%ds)", sid, max_idle_secs)
            await self.destroy_session(sid)
        return len(stale)

    async def cleanup_all(self) -> None:
        for sid in list(self.sessions):
            await self.destroy_session(sid)

    def get(self, session_id: str) -> Session | None:
        return self.sessions.get(session_id)
