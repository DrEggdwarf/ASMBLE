"""
Pydantic models — compatibles avec le StepSnapshot du frontend.
"""

from pydantic import BaseModel


class Flags(BaseModel):
    ZF: bool = False
    CF: bool = False
    SF: bool = False
    OF: bool = False
    PF: bool = False
    AF: bool = False
    DF: bool = False


class StackEntry(BaseModel):
    addr: int          # 0x7ffd...
    val: int           # 3
    label: str = ""    # "[RBP+8]", "[ret addr]", etc.
    isRsp: bool = False
    isRbp: bool = False


class DisasmEntry(BaseModel):
    addr: int
    bytes: str = ""
    instr: str = ""
    label: str = ""


class FrameInfo(BaseModel):
    level: int = 0
    addr: int = 0
    func: str = ""
    file: str = ""
    line: int = 0


class SectionInfo(BaseModel):
    name: str          # ".data", ".bss", ".text"
    start: int = 0
    end: int = 0
    size: int = 0


class StepSnapshot(BaseModel):
    ip: int                         # Numéro de ligne courante (0-indexed)
    instr: str                      # Instruction courante désassemblée
    regs: dict[str, int]            # {"rax": 0x3, "rbx": 0x0, ...}
    flags: Flags
    changed: list[str]              # Registres modifiés ["rax", "ZF"]
    stackEntries: list[StackEntry]
    annotation: str = ""            # Explication pédagogique
    jumped: bool = False            # True si un saut a été pris
    flagHint: str = ""              # Hint contextuel pour les flags
    disassembly: list[DisasmEntry] = []  # Désassemblage complet .text
    backtrace: list[FrameInfo] = []     # Stack frames
    sections: list[SectionInfo] = []    # ELF sections
    inferiorOutput: list[str] = []      # Program stdout/stderr


class AssembleRequest(BaseModel):
    code: str
    flavor: str = "nasm"  # "nasm" | "gas" | "fasm" | "yasm"


class AssembleResponse(BaseModel):
    success: bool
    errors: list[str] = []
    lines: int = 0
    binary_size: int = 0
    session_id: str = ""
