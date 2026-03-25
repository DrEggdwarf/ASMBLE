"""Tests for pedagogical annotations."""

from backend.app.annotations import annotate
from backend.app.models import Flags


REGS = {"rax": 0, "rbx": 0, "rcx": 0, "rdx": 0, "rsp": 0x7FFD0100, "rbp": 0x7FFD0120, "rdi": 0, "rsi": 0}


class TestAnnotateMov:
    def test_basic(self):
        result = annotate("mov rax, 1", REGS, Flags())
        assert "MOV" in result
        assert "rax, 1" in result

    def test_memory_operand(self):
        result = annotate("mov [rbp-8], rax", REGS, Flags())
        assert "MOV" in result


class TestAnnotatePushPop:
    def test_push(self):
        result = annotate("push rbp", REGS, Flags())
        assert "PUSH" in result
        assert "RSP" in result

    def test_pop(self):
        result = annotate("pop rbp", REGS, Flags())
        assert "POP" in result
        assert "RSP" in result


class TestAnnotateArithmetic:
    def test_add(self):
        result = annotate("add rax, rbx", REGS, Flags(ZF=True))
        assert "ADD" in result

    def test_sub(self):
        result = annotate("sub rax, 1", REGS, Flags(CF=True))
        assert "SUB" in result

    def test_cmp(self):
        result = annotate("cmp rax, 0", REGS, Flags(ZF=True))
        assert result  # should produce annotation


class TestAnnotateJumps:
    def test_jmp(self):
        result = annotate("jmp label", REGS, Flags())
        assert result

    def test_je(self):
        result = annotate("je label", REGS, Flags(ZF=True))
        assert result

    def test_jne(self):
        result = annotate("jne label", REGS, Flags())
        assert result


class TestAnnotateSyscall:
    def test_syscall(self):
        regs = {**REGS, "rax": 60}
        result = annotate("syscall", regs, Flags())
        assert result  # should produce annotation


class TestAnnotateSpecial:
    def test_xor_self(self):
        result = annotate("xor rax, rax", REGS, Flags())
        assert result

    def test_lea(self):
        result = annotate("lea rax, [rbp-8]", REGS, Flags())
        assert "LEA" in result

    def test_nop(self):
        result = annotate("nop", REGS, Flags())
        assert result

    def test_ret(self):
        result = annotate("ret", REGS, Flags())
        assert result

    def test_call(self):
        result = annotate("call factorial", REGS, Flags())
        assert result


class TestAnnotateEmpty:
    def test_empty_string(self):
        assert annotate("", REGS, Flags()) == ""

    def test_unknown_instruction(self):
        result = annotate("hlt", REGS, Flags())
        # May return empty or static annotation
        assert isinstance(result, str)
