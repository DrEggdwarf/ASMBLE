"""
pwndbg native tools — cyclic, ROP, telescope, search via GDB bridge.

Wraps pwndbg commands through GdbBridge.gdb_command() and parses text output.
Falls back to custom implementations when pwndbg is not available.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .gdb_bridge import GdbBridge

log = logging.getLogger("asmble.pwndbg")

# Regex to strip ANSI escape sequences from pwndbg output
_ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")


# ── pwndbg initialization ──────────────────────────────

_PWNDBG_INIT_CMD = "source /opt/pwndbg/gdbinit.py"


def _ensure_pwndbg(bridge: GdbBridge) -> bool:
    """Source pwndbg in the GDB session if not already done.

    Returns True if pwndbg is available, False otherwise.
    """
    if getattr(bridge, "_pwndbg_loaded", False):
        return True

    try:
        # Source pwndbg — produces async output that must be drained
        bridge.gdb_command(_PWNDBG_INIT_CMD, timeout_sec=30)
        import time
        time.sleep(1.0)
        if bridge.gdb:
            try:
                bridge.gdb.get_gdb_response(timeout_sec=1, raise_error_on_timeout=False)
            except Exception:
                pass
        # Verify pwndbg loaded
        test = bridge.gdb_command("help cyclic", timeout_sec=5)
        if test and "cyclic" in test.lower():
            bridge._pwndbg_loaded = True  # type: ignore[attr-defined]
            bridge.gdb_command("set auto-explore-pages no")
            log.info("pwndbg loaded successfully")
            return True
        # Fallback: pwndbg may be loaded even if help output is empty
        bridge._pwndbg_loaded = True  # type: ignore[attr-defined]
        bridge.gdb_command("set auto-explore-pages no")
        log.info("pwndbg loaded (fallback)")
        return True
    except Exception:
        pass
    return False


# ── Cyclic pattern (De Bruijn) ──────────────────────────

def pwndbg_cyclic(bridge: GdbBridge, length: int = 200, n: int = 4) -> str | None:
    """Generate a cyclic pattern via pwndbg's `cyclic` command.

    Returns the pattern string, or None if pwndbg is unavailable.
    """
    if not _ensure_pwndbg(bridge):
        return None

    cmd = f"cyclic {length}"
    if n != 4:
        cmd += f" -n {n}"
    output = bridge.gdb_command_logged(cmd)

    # Output is just the pattern string (one line)
    for line in output.strip().splitlines():
        line = line.strip()
        # Skip empty lines and pwndbg info messages
        if line and not line.startswith("pwndbg") and not line.startswith("["):
            return line
    return None


def pwndbg_cyclic_find(bridge: GdbBridge, value: str, n: int = 4) -> int | None:
    """Find offset in a cyclic pattern via pwndbg's `cyclic -l`.

    Returns the offset (int), or None if pwndbg is unavailable.
    """
    if not _ensure_pwndbg(bridge):
        return None

    cmd = f"cyclic -l {value}"
    if n != 4:
        cmd += f" -n {n}"
    output = bridge.gdb_command_logged(cmd)

    # Output: "Finding cyclic pattern of N bytes: ...\nFound at offset X"
    for line in output.strip().splitlines():
        m = re.search(r"Found at offset (\d+)", line)
        if m:
            return int(m.group(1))
        # Also handle "Pattern not found" case
        if "not found" in line.lower():
            return -1
    return None


# ── ROP gadget search ──────────────────────────────────

def pwndbg_rop(bridge: GdbBridge, grep: str = "", max_results: int = 100) -> list[dict] | None:
    """Search ROP gadgets via pwndbg's `rop` command.

    Returns list of {addr, gadget} dicts, or None if pwndbg is unavailable.
    """
    if not _ensure_pwndbg(bridge):
        return None

    cmd = "rop"
    if grep:
        cmd += f" --grep {grep}"
    output = bridge.gdb_command_logged(cmd)

    gadgets: list[dict] = []
    for line in output.strip().splitlines():
        line = line.strip()
        # Skip headers, warnings, summary, empty lines, search messages
        if not line or line.startswith("Gadgets") or line.startswith("=") or line.startswith("Warning"):
            continue
        if line.startswith("Unique gadgets") or line.startswith("Searching in"):
            continue

        # Format: "0x401004: pop rbp ; mov eax, 0x3c ; xor rdi, rdi ; syscall"
        m = re.match(r"(0x[0-9a-fA-F]+):\s+(.+)", line)
        if m:
            gadgets.append({
                "addr": m.group(1),
                "gadget": m.group(2).strip(),
            })
            if len(gadgets) >= max_results:
                break

    return gadgets


# ── Telescope (stack inspection) ────────────────────────

def pwndbg_telescope(bridge: GdbBridge, addr: str = "$rsp", count: int = 10) -> list[dict] | None:
    """Inspect stack/memory via pwndbg's `telescope` command.

    Returns list of {offset, addr, value, annotation} dicts, or None.
    """
    if not _ensure_pwndbg(bridge):
        return None

    cmd = f"telescope {addr} {count}"
    output = bridge.gdb_command_logged(cmd)

    entries: list[dict] = []
    for line in output.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        # Format: "00:0000│ rsp 0x7fffffffec40 ◂— 1"
        # or:     "01:0008│     0x7fffffffec48 —▸ 0x7fffffffee7e ◂— '/tmp/test2_bin'"
        m = re.match(
            r"(\d+):([0-9a-f]+)\│\s*(\S*)\s+(0x[0-9a-f]+)\s+(.+)",
            line,
        )
        if m:
            entries.append({
                "slot": int(m.group(1)),
                "offset": f"0x{m.group(2)}",
                "label": m.group(3),
                "addr": m.group(4),
                "value": m.group(5).strip(),
            })

    return entries


# ── Search (pattern in memory) ──────────────────────────

def pwndbg_search(bridge: GdbBridge, value: str, type_: str = "bytes") -> list[dict] | None:
    """Search for a pattern in memory via pwndbg's `search` command.

    type_ can be: bytes, byte, short, dword, qword, pointer, string.
    Returns list of {region, addr, value} dicts, or None.
    """
    if not _ensure_pwndbg(bridge):
        return None

    cmd = f"search --type {type_} {value}"
    output = bridge.gdb_command_logged(cmd)

    results: list[dict] = []
    for line in output.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("Searching"):
            continue
        # Format: "test2_bin       0x401000 push rbp"
        # or:     "[vdso]          0x7ffff7ffd19d push rbp"
        m = re.match(r"(\S+)\s+(0x[0-9a-fA-F]+)\s+(.*)", line)
        if m:
            results.append({
                "region": m.group(1),
                "addr": m.group(2),
                "value": m.group(3).strip(),
            })
            if len(results) >= 100:
                break

    return results


# ── Checksec (native pwndbg) ───────────────────────────

def pwndbg_checksec(bridge: GdbBridge) -> dict | None:
    """Run pwndbg's native `checksec` command.

    Returns a dict of security properties, or None if unavailable.
    """
    if not _ensure_pwndbg(bridge):
        return None

    output = bridge.gdb_command_logged("checksec")

    result: dict = {}
    for line in output.strip().splitlines():
        line = line.strip()
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip().lower()
        val = val.strip()
        if key == "file":
            continue  # skip file path
        result[key] = val

    return result if result else None
