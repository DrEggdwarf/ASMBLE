"""Tests for pwndbg native tools (output parsers)."""

from unittest.mock import MagicMock

from backend.app.pwndbg_tools import (
    pwndbg_cyclic,
    pwndbg_cyclic_find,
    pwndbg_rop,
    pwndbg_telescope,
    pwndbg_search,
    pwndbg_checksec,
    _ensure_pwndbg,
)


def _mock_bridge(pwndbg_loaded: bool = True):
    """Create a mock GdbBridge with pwndbg loaded flag."""
    bridge = MagicMock()
    bridge._pwndbg_loaded = pwndbg_loaded
    # pwndbg tools use gdb_command_logged — make it a separate mock
    # that can be configured independently
    bridge.gdb_command_logged = MagicMock()
    return bridge


class TestEnsurePwndbg:
    def test_already_loaded(self):
        bridge = _mock_bridge(pwndbg_loaded=True)
        assert _ensure_pwndbg(bridge) is True
        bridge.gdb_command.assert_not_called()

    def test_loads_on_first_call(self):
        bridge = MagicMock(spec=[])
        bridge.gdb_command = MagicMock(return_value="loaded 194 pwndbg commands")
        bridge.gdb = MagicMock()
        bridge.gdb.get_gdb_response = MagicMock(return_value=[])
        assert _ensure_pwndbg(bridge) is True
        assert bridge._pwndbg_loaded is True

    def test_fails_gracefully(self):
        bridge = MagicMock(spec=[])
        bridge.gdb_command = MagicMock(side_effect=Exception("GDB error"))
        assert _ensure_pwndbg(bridge) is False


class TestPwndbgCyclic:
    def test_parse_pattern(self):
        bridge = _mock_bridge()
        bridge.gdb_command_logged.return_value = "aaaabaaacaaadaaaeaaa"
        result = pwndbg_cyclic(bridge, 20)
        assert result == "aaaabaaacaaadaaaeaaa"
        bridge.gdb_command_logged.assert_called_once_with("cyclic 20")

    def test_custom_n(self):
        bridge = _mock_bridge()
        bridge.gdb_command_logged.return_value = "aaaabaaa"
        result = pwndbg_cyclic(bridge, 8, n=8)
        bridge.gdb_command_logged.assert_called_once_with("cyclic 8 -n 8")

    def test_returns_none_when_unavailable(self):
        bridge = MagicMock(spec=[])
        bridge.gdb_command = MagicMock(side_effect=Exception("fail"))
        result = pwndbg_cyclic(bridge, 20)
        assert result is None


class TestPwndbgCyclicFind:
    def test_parse_offset(self):
        bridge = _mock_bridge()
        bridge.gdb_command_logged.return_value = (
            "Finding cyclic pattern of 4 bytes: b'baaa' (hex: 0x62616161)\n"
            "Found at offset 4"
        )
        result = pwndbg_cyclic_find(bridge, "0x61616162")
        assert result == 4

    def test_not_found(self):
        bridge = _mock_bridge()
        bridge.gdb_command_logged.return_value = "Pattern not found"
        result = pwndbg_cyclic_find(bridge, "ZZZZ")
        assert result == -1


class TestPwndbgRop:
    def test_parse_gadgets(self):
        bridge = _mock_bridge()
        bridge.gdb_command_logged.return_value = (
            "Gadgets information\n"
            "============================================================\n"
            "0x401004: pop rbp ; mov eax, 0x3c ; xor rdi, rdi ; syscall\n"
            "0x40100d: syscall\n"
            "0x40100b: xor edi, edi ; syscall\n"
            "\n"
            "Unique gadgets found: 3\n"
        )
        result = pwndbg_rop(bridge)
        assert result is not None
        assert len(result) == 3
        assert result[0]["addr"] == "0x401004"
        assert result[0]["gadget"] == "pop rbp ; mov eax, 0x3c ; xor rdi, rdi ; syscall"

    def test_with_grep(self):
        bridge = _mock_bridge()
        bridge.gdb_command_logged.return_value = (
            "Gadgets information\n"
            "============================================================\n"
            "0x401004: pop rbp ; mov eax, 0x3c ; xor rdi, rdi ; syscall\n"
            "\n"
            "Unique gadgets found: 1\n"
        )
        result = pwndbg_rop(bridge, grep="pop")
        bridge.gdb_command_logged.assert_called_once_with("rop --grep pop")
        assert len(result) == 1


class TestPwndbgTelescope:
    def test_parse_entries(self):
        bridge = _mock_bridge()
        bridge.gdb_command_logged.return_value = (
            "00:0000│ rsp 0x7fffffffec40 ◂— 1\n"
            "01:0008│     0x7fffffffec48 —▸ 0x7fffffffee7e ◂— '/tmp/test'\n"
            "02:0010│     0x7fffffffec50 ◂— 0\n"
        )
        result = pwndbg_telescope(bridge, "$rsp", 3)
        assert result is not None
        assert len(result) == 3
        assert result[0]["slot"] == 0
        assert result[0]["label"] == "rsp"
        assert result[0]["addr"] == "0x7fffffffec40"
        assert result[1]["label"] == ""


class TestPwndbgSearch:
    def test_parse_results(self):
        bridge = _mock_bridge()
        bridge.gdb_command_logged.return_value = (
            "Searching for byte: b'U'\n"
            "test_bin       0x401000 push rbp\n"
            "[vdso]          0x7ffff7ffd19d push rbp\n"
        )
        result = pwndbg_search(bridge, "0x55", "byte")
        assert result is not None
        assert len(result) == 2
        assert result[0]["region"] == "test_bin"
        assert result[0]["addr"] == "0x401000"


class TestPwndbgChecksec:
    def test_parse_checksec(self):
        bridge = _mock_bridge()
        bridge.gdb_command_logged.return_value = (
            "File:     /tmp/test\n"
            "Arch:     amd64\n"
            "RELRO:      No RELRO\n"
            "Stack:      No canary found\n"
            "NX:         NX unknown - GNU_STACK missing\n"
            "PIE:        No PIE (0x400000)\n"
        )
        result = pwndbg_checksec(bridge)
        assert result is not None
        assert result["arch"] == "amd64"
        assert result["relro"] == "No RELRO"
        assert "pie" in result
