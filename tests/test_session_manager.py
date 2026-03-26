"""Tests for session manager timeout and cleanup."""

import time
import pytest

from backend.app.session_manager import Session, SessionManager
from pathlib import Path


def test_session_touch():
    """Session.touch() should update last_activity."""
    s = Session("test123", Path("/tmp/fake"))
    t1 = s.last_activity
    time.sleep(0.01)
    s.touch()
    assert s.last_activity > t1


@pytest.mark.asyncio
async def test_cleanup_stale():
    """cleanup_stale should remove idle sessions."""
    mgr = SessionManager(max_sessions=5)
    # Create a session manually (without real assembly)
    s = Session("old-session", Path("/tmp/fake-nonexistent"))
    s.last_activity = time.monotonic() - 999  # very old
    mgr.sessions["old-session"] = s

    removed = await mgr.cleanup_stale(max_idle_secs=10)
    assert removed == 1
    assert "old-session" not in mgr.sessions


@pytest.mark.asyncio
async def test_cleanup_stale_keeps_active():
    """cleanup_stale should keep recently active sessions."""
    mgr = SessionManager(max_sessions=5)
    s = Session("active-session", Path("/tmp/fake-nonexistent"))
    s.last_activity = time.monotonic()  # just now
    mgr.sessions["active-session"] = s

    removed = await mgr.cleanup_stale(max_idle_secs=10)
    assert removed == 0
    assert "active-session" in mgr.sessions
    # Cleanup
    del mgr.sessions["active-session"]


def test_max_sessions_default():
    """SessionManager default max_sessions should be configurable."""
    mgr = SessionManager(max_sessions=5)
    assert mgr.max_sessions == 5
