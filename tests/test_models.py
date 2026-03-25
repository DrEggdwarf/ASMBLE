"""Tests for Pydantic models."""

from backend.app.models import (
    Flags, StackEntry, DisasmEntry, FrameInfo, SectionInfo,
    StepSnapshot, AssembleRequest, AssembleResponse,
)


class TestFlags:
    def test_defaults(self):
        f = Flags()
        assert f.ZF is False
        assert f.CF is False
        assert f.SF is False
        assert f.OF is False
        assert f.PF is False
        assert f.AF is False
        assert f.DF is False

    def test_set_flags(self):
        f = Flags(ZF=True, CF=True)
        assert f.ZF is True
        assert f.CF is True
        assert f.SF is False

    def test_serialization(self):
        f = Flags(ZF=True)
        d = f.model_dump()
        assert d["ZF"] is True
        assert d["CF"] is False


class TestStackEntry:
    def test_defaults(self):
        e = StackEntry(addr=0x7FFD0000, val=42)
        assert e.addr == 0x7FFD0000
        assert e.val == 42
        assert e.label == ""
        assert e.isRsp is False
        assert e.isRbp is False

    def test_with_labels(self):
        e = StackEntry(addr=0, val=0, label="[RSP]", isRsp=True)
        assert e.label == "[RSP]"
        assert e.isRsp is True


class TestStepSnapshot:
    def test_minimal(self):
        s = StepSnapshot(
            ip=0,
            instr="mov rax, 1",
            regs={"rax": 1, "rsp": 0x7FFD0000},
            flags=Flags(),
            changed=["rax"],
            stackEntries=[],
        )
        assert s.ip == 0
        assert s.instr == "mov rax, 1"
        assert s.regs["rax"] == 1
        assert s.changed == ["rax"]
        assert s.annotation == ""
        assert s.jumped is False
        assert s.disassembly == []
        assert s.inferiorOutput == []

    def test_full(self):
        s = StepSnapshot(
            ip=5,
            instr="syscall",
            regs={"rax": 60},
            flags=Flags(ZF=True),
            changed=["rax", "ZF"],
            stackEntries=[StackEntry(addr=0x1000, val=0, isRsp=True)],
            annotation="Appel système",
            jumped=True,
            flagHint="ZF=1",
            disassembly=[DisasmEntry(addr=0x401000, instr="syscall")],
            backtrace=[FrameInfo(level=0, func="_start")],
            sections=[SectionInfo(name=".text", start=0x401000, end=0x401100, size=256)],
            inferiorOutput=["Hello"],
        )
        assert s.jumped is True
        assert len(s.stackEntries) == 1
        assert s.stackEntries[0].isRsp is True
        assert s.inferiorOutput == ["Hello"]


class TestAssembleRequest:
    def test_defaults(self):
        r = AssembleRequest(code="mov rax, 1")
        assert r.code == "mov rax, 1"
        assert r.flavor == "nasm"

    def test_custom_flavor(self):
        r = AssembleRequest(code="mov %rax, 1", flavor="gas")
        assert r.flavor == "gas"


class TestAssembleResponse:
    def test_success(self):
        r = AssembleResponse(
            success=True, lines=10, binary_size=1024, session_id="abc-123"
        )
        assert r.success is True
        assert r.errors == []

    def test_failure(self):
        r = AssembleResponse(
            success=False, errors=["line 3: invalid syntax"]
        )
        assert r.success is False
        assert len(r.errors) == 1
