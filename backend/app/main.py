"""
ASMBLE Backend — FastAPI + GDB/MI Bridge
Debugger x86-64 pédagogique conteneurisé.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .session_manager import SessionManager
from .security import checksec, vmmap, got_entries
from .exploit_tools import cyclic, cyclic_find, rop_search
from .pwndbg_tools import (
    pwndbg_cyclic, pwndbg_cyclic_find, pwndbg_rop,
    pwndbg_telescope, pwndbg_search, pwndbg_checksec,
)
from .sandbox import NSJAIL_AVAILABLE

log = logging.getLogger("asmble")
logging.basicConfig(level=logging.INFO)

max_sessions = int(os.environ.get("ASMBLE_MAX_SESSIONS", "5"))
session_idle_timeout = int(os.environ.get("ASMBLE_SESSION_IDLE_TIMEOUT", "600"))
allowed_origins = os.environ.get(
    "ASMBLE_CORS_ORIGINS",
    "http://localhost:5173,http://localhost:8080",
).split(",")
manager = SessionManager(max_sessions=max_sessions)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_session_cleanup_loop())
    log.info("ASMBLE backend started (max_sessions=%d, idle_timeout=%ds, nsjail=%s)",
             max_sessions, session_idle_timeout, NSJAIL_AVAILABLE)
    yield
    task.cancel()
    await manager.cleanup_all()


async def _session_cleanup_loop() -> None:
    """Periodically remove sessions idle for too long."""
    while True:
        await asyncio.sleep(60)
        await manager.cleanup_stale(session_idle_timeout)


app = FastAPI(
    title="ASMBLE",
    description="x86-64 Assembly Debugger — GDB/MI Backend",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ── REST ────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "sessions": manager.active_count, "max_sessions": max_sessions}


@app.get("/api/health/detailed")
async def health_detailed():
    import shutil
    checks = {
        "status": "ok",
        "sessions": manager.active_count,
        "max_sessions": max_sessions,
        "session_idle_timeout": session_idle_timeout,
        "nsjail": NSJAIL_AVAILABLE,
        "tools": {},
    }
    for tool in ("nasm", "gdb", "yasm", "gcc", "nsjail"):
        checks["tools"][tool] = shutil.which(tool) is not None
    try:
        import pygdbmi  # noqa: F401
        checks["tools"]["pygdbmi"] = True
    except ImportError:
        checks["tools"]["pygdbmi"] = False
    checks["all_tools_ok"] = all(checks["tools"].values())
    if not checks["all_tools_ok"]:
        checks["status"] = "degraded"
    return checks


# ── WebSocket ───────────────────────────────────────

@app.websocket("/api/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    log.info("WebSocket connection open")
    session_id: str | None = None

    # ── helpers ──

    async def _assemble_session(data: dict, run_after: bool) -> str | None:
        """Create a debug session, optionally run to completion."""
        code = data.get("code", "")
        flavor = data.get("flavor", "nasm")
        session, result = await manager.create_session(code, flavor)
        if not result.success:
            await ws.send_json({
                "type": "error",
                "message": "\n".join(result.errors),
                "phase": "assemble",
            })
            return None
        new_id = session.id
        await asyncio.to_thread(session.read_state)
        await ws.send_json({
            "type": "session",
            "id": new_id,
            "lines": result.lines,
            "binary_size": result.binary_size,
        })
        # Auto-checksec after successful assembly
        try:
            cs = await asyncio.to_thread(checksec, session.binary_path)
            await ws.send_json({"type": "checksec", "payload": cs})
        except Exception:
            pass  # non-critical
        if run_after:
            snapshot = await asyncio.to_thread(session.continue_exec)
            await ws.send_json({"type": "snapshot", "payload": snapshot.model_dump()})
            if snapshot.ip == 0:
                await ws.send_json({
                    "type": "program_exit",
                    "code": 0,
                    "output": snapshot.inferiorOutput,
                })
        else:
            snapshot = await asyncio.to_thread(session.read_state)
            await ws.send_json({"type": "snapshot", "payload": snapshot.model_dump()})
        return new_id

    def _get(sid: str | None):
        if not sid:
            raise ValueError("No active session — send 'assemble' first")
        s = manager.get(sid)
        if not s:
            raise ValueError(f"Session {sid} not found")
        return s

    async def _snap(sid: str | None, method: str) -> None:
        session = _get(sid)
        snapshot = await asyncio.to_thread(getattr(session, method))
        await ws.send_json({"type": "snapshot", "payload": snapshot.model_dump()})

    # ── dispatch handlers ──

    async def _h_assemble(data: dict) -> str | None:
        return await _assemble_session(data, run_after=False)

    async def _h_run(data: dict) -> str | None:
        return await _assemble_session(data, run_after=True)

    async def _h_step(data: dict) -> str | None:
        await _snap(session_id, "step")
        return None

    async def _h_step_over(data: dict) -> str | None:
        await _snap(session_id, "step_over")
        return None

    async def _h_step_out(data: dict) -> str | None:
        await _snap(session_id, "step_out")
        return None

    async def _h_step_back(data: dict) -> str | None:
        await _snap(session_id, "step_back")
        return None

    async def _h_continue(data: dict) -> str | None:
        await _snap(session_id, "continue_exec")
        return None

    async def _h_breakpoint_add(data: dict) -> str | None:
        session = _get(session_id)
        bp_id = await asyncio.to_thread(
            session.add_breakpoint, data["line"], data.get("condition", ""),
        )
        await ws.send_json({"type": "breakpoint_added", "line": data["line"], "id": bp_id})
        return None

    async def _h_breakpoint_remove(data: dict) -> str | None:
        session = _get(session_id)
        await asyncio.to_thread(session.remove_breakpoint, data["line"])
        return None

    async def _h_watchpoint_add(data: dict) -> str | None:
        session = _get(session_id)
        wp_id = await asyncio.to_thread(
            session.add_watchpoint, data["expr"], data.get("kind", "write"),
        )
        await ws.send_json({"type": "watchpoint_added", "expr": data["expr"], "id": wp_id})
        return None

    async def _h_watchpoint_remove(data: dict) -> str | None:
        session = _get(session_id)
        await asyncio.to_thread(session.remove_watchpoint, data["id"])
        return None

    async def _h_set_register(data: dict) -> str | None:
        session = _get(session_id)
        await asyncio.to_thread(session.set_register, data["reg"], data["value"])
        snapshot = await asyncio.to_thread(session.read_state)
        await ws.send_json({"type": "snapshot", "payload": snapshot.model_dump()})
        return None

    async def _h_set_args(data: dict) -> str | None:
        session = _get(session_id)
        await asyncio.to_thread(session.set_args, data["args"])
        return None

    async def _h_gdb_command(data: dict) -> str | None:
        session = _get(session_id)
        output = await asyncio.to_thread(session.gdb_command, data["cmd"])
        await ws.send_json({"type": "gdb_output", "cmd": data["cmd"], "output": output})
        return None

    async def _h_read_section(data: dict) -> str | None:
        session = _get(session_id)
        entries = await asyncio.to_thread(session.read_section_data, data["name"])
        await ws.send_json({"type": "section_data", "name": data["name"], "entries": entries})
        return None

    async def _h_read_memory(data: dict) -> str | None:
        session = _get(session_id)
        mem = await asyncio.to_thread(session.read_memory, data["addr"], data["size"])
        await ws.send_json({"type": "memory", "addr": data["addr"], "data": mem.hex()})
        return None

    async def _h_evaluate(data: dict) -> str | None:
        session = _get(session_id)
        val = await asyncio.to_thread(session.evaluate, data["expr"])
        await ws.send_json({"type": "eval_result", "expr": data["expr"], "value": val})
        return None

    async def _h_reset(data: dict) -> str | None:
        nonlocal session_id
        if not session_id:
            return None
        old_session = manager.get(session_id)
        if not old_session:
            return None
        code, flavor = old_session.last_code, old_session.last_flavor
        await manager.destroy_session(session_id)
        session, result = await manager.create_session(code, flavor)
        if result.success:
            session_id = session.id
            snapshot = await asyncio.to_thread(session.read_state)
            await ws.send_json({"type": "snapshot", "payload": snapshot.model_dump()})
        return None

    async def _h_checksec(data: dict) -> str | None:
        session = _get(session_id)
        result = await asyncio.to_thread(checksec, session.binary_path)
        await ws.send_json({"type": "checksec", "payload": result})
        return None

    async def _h_vmmap(data: dict) -> str | None:
        session = _get(session_id)
        pid = session.inferior_pid
        result = await asyncio.to_thread(vmmap, pid, session.binary_path)
        await ws.send_json({"type": "vmmap", "payload": result})
        return None

    async def _h_got(data: dict) -> str | None:
        session = _get(session_id)
        result = await asyncio.to_thread(got_entries, session.binary_path)
        await ws.send_json({"type": "got", "payload": result})
        return None

    async def _h_cyclic(data: dict) -> str | None:
        length = int(data.get("length", 200))
        n = int(data.get("n", 4))
        # Try pwndbg native first (needs active GDB session)
        pattern = None
        if session_id:
            session = manager.get(session_id)
            if session and session.bridge:
                pattern = await asyncio.to_thread(pwndbg_cyclic, session.bridge, length, n)
        # Fallback to custom implementation
        if pattern is None:
            pattern = cyclic(length, n)
        await ws.send_json({"type": "cyclic", "pattern": pattern})
        return None

    async def _h_cyclic_find(data: dict) -> str | None:
        value = data.get("value", "")
        n = int(data.get("n", 4))
        # Try pwndbg native first
        offset = None
        if session_id:
            session = manager.get(session_id)
            if session and session.bridge:
                offset = await asyncio.to_thread(pwndbg_cyclic_find, session.bridge, value, n)
        # Fallback to custom implementation
        if offset is None:
            offset = cyclic_find(value, n)
        await ws.send_json({"type": "cyclic_find", "value": value, "offset": offset})
        return None

    async def _h_rop(data: dict) -> str | None:
        session = _get(session_id)
        filter_str = data.get("filter", "")
        # Try pwndbg native first
        gadgets = None
        if session.bridge:
            gadgets = await asyncio.to_thread(pwndbg_rop, session.bridge, filter_str)
        # Fallback to custom ROPgadget subprocess
        if gadgets is None:
            gadgets = await asyncio.to_thread(rop_search, session.binary_path, filter_str)
        await ws.send_json({"type": "rop", "gadgets": gadgets})
        return None

    async def _h_telescope(data: dict) -> str | None:
        session = _get(session_id)
        addr = data.get("addr", "$rsp")
        count = int(data.get("count", 10))
        entries = None
        if session.bridge:
            entries = await asyncio.to_thread(pwndbg_telescope, session.bridge, addr, count)
        await ws.send_json({"type": "telescope", "entries": entries or []})
        return None

    async def _h_search(data: dict) -> str | None:
        session = _get(session_id)
        value = data.get("value", "")
        type_ = data.get("search_type", "bytes")
        results = None
        if session.bridge:
            results = await asyncio.to_thread(pwndbg_search, session.bridge, value, type_)
        await ws.send_json({"type": "search", "results": results or []})
        return None

    dispatch: dict[str, object] = {
        "assemble": _h_assemble,
        "run": _h_run,
        "step": _h_step,
        "step_over": _h_step_over,
        "step_out": _h_step_out,
        "step_back": _h_step_back,
        "continue": _h_continue,
        "breakpoint_add": _h_breakpoint_add,
        "breakpoint_remove": _h_breakpoint_remove,
        "watchpoint_add": _h_watchpoint_add,
        "watchpoint_remove": _h_watchpoint_remove,
        "set_register": _h_set_register,
        "set_args": _h_set_args,
        "gdb_command": _h_gdb_command,
        "read_section": _h_read_section,
        "read_memory": _h_read_memory,
        "evaluate": _h_evaluate,
        "reset": _h_reset,
        "checksec": _h_checksec,
        "vmmap": _h_vmmap,
        "got": _h_got,
        "cyclic": _h_cyclic,
        "cyclic_find": _h_cyclic_find,
        "rop": _h_rop,
        "telescope": _h_telescope,
        "search": _h_search,
    }

    # ── rate limiter (token bucket) ──
    _rl_tokens = 30.0   # max burst
    _rl_rate = 20.0     # tokens/sec refill
    _rl_last = time.monotonic()

    # ── main loop ──

    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type")
            log.info(f"WS recv: {msg_type}")

            # Rate limiting
            now = time.monotonic()
            _rl_tokens = min(30.0, _rl_tokens + (now - _rl_last) * _rl_rate)
            _rl_last = now
            if _rl_tokens < 1.0:
                await ws.send_json({
                    "type": "error",
                    "message": "Rate limit exceeded — please slow down",
                    "phase": "runtime",
                })
                continue
            _rl_tokens -= 1.0

            # Track session activity for auto-cleanup
            if session_id:
                s = manager.get(session_id)
                if s:
                    s.touch()

            if msg_type == "disconnect":
                break

            handler = dispatch.get(msg_type)
            if not handler:
                await ws.send_json({
                    "type": "error",
                    "message": f"Unknown message type: {msg_type}",
                    "phase": "runtime",
                })
                continue

            try:
                new_id = await handler(data)
                if new_id is not None:
                    session_id = new_id
            except (AssertionError, KeyError, ValueError) as exc:
                await ws.send_json({
                    "type": "error",
                    "message": str(exc),
                    "phase": "runtime",
                })
            except Exception as exc:
                log.exception("WebSocket handler error")
                await ws.send_json({
                    "type": "error",
                    "message": str(exc),
                    "phase": "runtime",
                })

    except WebSocketDisconnect:
        pass
    finally:
        if session_id:
            await manager.destroy_session(session_id)
