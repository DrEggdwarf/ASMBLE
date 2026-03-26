"""Tests for sandbox resource limits and nsjail command builder."""

import resource

from backend.app.sandbox import apply_sandbox_limits, build_gdb_command, NSJAIL_AVAILABLE


def test_sandbox_limits_applied():
    """Sandbox should set resource limits without raising."""
    # Save current limits to restore later
    saved = {
        resource.RLIMIT_CPU: resource.getrlimit(resource.RLIMIT_CPU),
        resource.RLIMIT_AS: resource.getrlimit(resource.RLIMIT_AS),
        resource.RLIMIT_NPROC: resource.getrlimit(resource.RLIMIT_NPROC),
        resource.RLIMIT_FSIZE: resource.getrlimit(resource.RLIMIT_FSIZE),
        resource.RLIMIT_NOFILE: resource.getrlimit(resource.RLIMIT_NOFILE),
    }

    try:
        apply_sandbox_limits()

        # Verify limits are set
        cpu_soft, _ = resource.getrlimit(resource.RLIMIT_CPU)
        assert cpu_soft == 10

        nproc_soft, _ = resource.getrlimit(resource.RLIMIT_NPROC)
        assert nproc_soft == 10

        fsize_soft, _ = resource.getrlimit(resource.RLIMIT_FSIZE)
        assert fsize_soft == 1 * 1024 * 1024
    finally:
        # Restore original limits
        for res, limit in saved.items():
            try:
                resource.setrlimit(res, limit)
            except ValueError:
                pass  # Can't raise limit above hard limit


def test_build_gdb_command_fallback():
    """Without nsjail, returns plain GDB command."""
    cmd = build_gdb_command("/tmp/binary", "/tmp/workdir")
    if not NSJAIL_AVAILABLE:
        assert cmd == ["gdb", "--interpreter=mi3", "-nh", "/tmp/binary"]
    else:
        # With nsjail, command starts with nsjail
        assert cmd[0].endswith("nsjail")
        assert "--clone_newnet" in cmd
        assert "--clone_newns" in cmd
        assert "gdb" in cmd
        assert "/tmp/binary" in cmd


def test_build_gdb_command_contains_binary_path():
    """Binary path must appear in the command."""
    cmd = build_gdb_command("/tmp/test/binary", "/tmp/test")
    assert "/tmp/test/binary" in cmd


def test_build_gdb_command_workdir_mounted():
    """When nsjail is available, workdir must be bind-mounted."""
    cmd = build_gdb_command("/tmp/asm-abc/binary", "/tmp/asm-abc")
    if NSJAIL_AVAILABLE:
        # -B workdir for writable bind mount
        idx = cmd.index("-B")
        found = False
        for i, arg in enumerate(cmd):
            if arg == "-B" and i + 1 < len(cmd) and cmd[i + 1] == "/tmp/asm-abc":
                found = True
                break
        assert found, "Workdir should be bind-mounted with -B"
