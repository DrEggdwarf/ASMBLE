"""
Sandbox — Process isolation for user code execution.

Uses nsjail when available (Docker prod) for mount/network namespace isolation.
Falls back to rlimits only (dev mode) when nsjail is not installed.
"""

import logging
import os
import resource
import shutil
from pathlib import Path

log = logging.getLogger("asmble.sandbox")

_nsjail_bin = shutil.which("nsjail")
NSJAIL_AVAILABLE = _nsjail_bin is not None and os.environ.get("ASMBLE_SANDBOX") != "off"


def apply_sandbox_limits() -> None:
    """
    Resource limits via setrlimit — used for assembly subprocess
    and as fallback when nsjail is not available.
    """
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NPROC, (10, 10))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1 * 1024 * 1024, 1 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))


def build_gdb_command(binary_path: str, workdir: str) -> list[str]:
    """Build GDB command, optionally wrapped in nsjail for namespace isolation.

    When nsjail is available: mount namespace (fs isolation) + network namespace
    (no connectivity) + IPC namespace + resource limits.
    When not available: plain GDB with rlimits applied to the assembler subprocess only.
    """
    base_cmd = ["gdb", "--interpreter=mi3", "-nh", binary_path]

    if not NSJAIL_AVAILABLE:
        return base_cmd

    log.info("nsjail: sandboxing GDB session (workdir=%s)", workdir)

    cmd: list[str] = [
        _nsjail_bin,
        "--mode", "o",
        "--log", "/dev/null",
        # -- Namespaces --
        "--disable_clone_newuser",   # no user ns (requires SYS_ADMIN for other ns)
        "--disable_clone_newpid",    # keep host PID ns (vmmap reads /proc/<pid>/maps)
        "--disable_clone_newcgroup",
        # newns (mount), newnet, newipc, newuts: kept enabled by default
        # -- Resource limits --
        "--rlimit_as", "hard",
        "--rlimit_cpu", "30",
        "--rlimit_fsize", "1",
        "--rlimit_nofile", "64",
        "--time_limit", "120",
    ]

    # Read-only system mounts
    for path in ("/lib", "/lib64", "/usr", "/bin", "/sbin", "/etc"):
        if Path(path).exists():
            cmd += ["-R", path]

    # Writable device files
    for dev in ("/dev/null", "/dev/zero", "/dev/urandom"):
        if Path(dev).exists():
            cmd += ["-B", dev]

    # PTY devices (needed for inferior I/O via -inferior-tty-set)
    if Path("/dev/pts").exists():
        cmd += ["-B", "/dev/pts"]
    if Path("/dev/ptmx").exists():
        cmd += ["-B", "/dev/ptmx"]

    # Special filesystems
    cmd += [
        "--mount", "none:/proc:proc",
        "--mount", "none:/tmp:tmpfs:size=16777216",
    ]

    # Writable workdir (binary + source)
    cmd += ["-B", workdir]

    # pwndbg and Python venv (read-only, needed for pwndbg commands inside GDB)
    for pwndbg_path in ("/opt/pwndbg", "/app/venv"):
        if Path(pwndbg_path).exists():
            cmd += ["-R", pwndbg_path]

    # Environment
    cmd += [
        "--cwd", workdir,
        "-E", f"HOME={workdir}",
        "-E", "PATH=/usr/local/bin:/usr/bin:/bin:/sbin",
        "-E", "PWNDBG_VENV_PATH=/app/venv",
        "-E", "PWNDBG_NO_AUTOUPDATE=1",
        "-E", "TERM=dumb",
    ]

    cmd += ["--", "/usr/bin/gdb", "--interpreter=mi3", "-nh", binary_path]
    return cmd
