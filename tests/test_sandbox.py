"""Tests for sandbox resource limits."""

import resource

from backend.app.sandbox import apply_sandbox_limits


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
