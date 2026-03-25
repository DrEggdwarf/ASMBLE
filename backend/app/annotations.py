"""
Annotations pédagogiques — génère des explications contextuelles pour chaque instruction.
"""

from __future__ import annotations

from collections.abc import Callable

from .models import Flags


def annotate(instr: str, regs: dict[str, int], flags: Flags) -> str:
    """Génère une annotation pédagogique pour l'instruction courante."""
    if not instr:
        return ""

    parts = instr.strip().split(None, 1)
    mnemonic = parts[0].lower()
    operands = parts[1] if len(parts) > 1 else ""

    gen = ANNOTATION_GENERATORS.get(mnemonic)
    if gen:
        return gen(operands, regs, flags)

    return STATIC_ANNOTATIONS.get(mnemonic, "")


def _annotate_mov(ops: str, regs: dict, flags: Flags) -> str:
    return f"MOV {ops} — copie la valeur source dans la destination. Ne modifie aucun flag."


def _annotate_push(ops: str, regs: dict, flags: Flags) -> str:
    rsp = regs.get("rsp", 0)
    return f"PUSH {ops} — empile la valeur. RSP -= 8 (RSP = 0x{rsp:x})."


def _annotate_pop(ops: str, regs: dict, flags: Flags) -> str:
    rsp = regs.get("rsp", 0)
    return f"POP {ops} — dépile dans {ops}. RSP += 8 (RSP = 0x{rsp:x})."


def _annotate_add(ops: str, regs: dict, flags: Flags) -> str:
    flag_state = _flag_summary(flags)
    return f"ADD {ops} — addition. {flag_state}"


def _annotate_sub(ops: str, regs: dict, flags: Flags) -> str:
    flag_state = _flag_summary(flags)
    return f"SUB {ops} — soustraction. {flag_state}"


def _annotate_cmp(ops: str, regs: dict, flags: Flags) -> str:
    hint = ""
    if flags.ZF:
        hint = "Les opérandes sont égaux (ZF=1)."
    elif flags.SF != flags.OF:
        hint = "< en signé (SF≠OF)."
    elif flags.CF:
        hint = "< en non-signé (CF=1)."
    else:
        hint = "> en non-signé (CF=0, ZF=0)."
    return f"CMP {ops} — comparaison (soustraction sans stocker). {hint}"


def _annotate_xor(ops: str, regs: dict, flags: Flags) -> str:
    parts = [p.strip() for p in ops.split(",")]
    if len(parts) == 2 and parts[0] == parts[1]:
        return f"XOR {parts[0]},{parts[1]} — mise à zéro de {parts[0]} (idiome classique)."
    return f"XOR {ops} — OU exclusif bit à bit."


def _annotate_call(ops: str, regs: dict, flags: Flags) -> str:
    return f"CALL {ops} — empile l'adresse de retour et saute à {ops}."


def _annotate_ret(ops: str, regs: dict, flags: Flags) -> str:
    return "RET — dépile l'adresse de retour et y saute."


def _annotate_jmp(ops: str, regs: dict, flags: Flags) -> str:
    return f"JMP {ops} — saut inconditionnel."


def _annotate_syscall(ops: str, regs: dict, flags: Flags) -> str:
    rax = regs.get("rax", 0)
    SYSCALL_NAMES = {0: "read", 1: "write", 60: "exit", 59: "execve", 57: "fork", 2: "open", 3: "close"}
    name = SYSCALL_NAMES.get(rax, f"syscall #{rax}")
    return f"SYSCALL — appel système Linux : {name} (rax={rax})."


def _annotate_lea(ops: str, regs: dict, flags: Flags) -> str:
    return f"LEA {ops} — charge l'adresse effective (pas la valeur). Ne modifie aucun flag."


def _annotate_nop(ops: str, regs: dict, flags: Flags) -> str:
    return "NOP — ne fait rien (1 cycle)."


def _annotate_test(ops: str, regs: dict, flags: Flags) -> str:
    hint = _flag_summary(flags)
    return f"TEST {ops} — ET logique sans stocker le résultat (met à jour les flags). {hint}"


def _flag_summary(flags: Flags) -> str:
    """Résumé des flags actifs."""
    active = []
    if flags.ZF: active.append("ZF=1 (résultat nul)")
    if flags.CF: active.append("CF=1 (retenue)")
    if flags.SF: active.append("SF=1 (négatif)")
    if flags.OF: active.append("OF=1 (overflow)")
    return "Flags : " + ", ".join(active) if active else "Aucun flag actif."


# Générateurs dynamiques
ANNOTATION_GENERATORS: dict[str, Callable[[str, dict, Flags], str]] = {
    "mov": _annotate_mov,
    "movzx": _annotate_mov,
    "movsx": _annotate_mov,
    "push": _annotate_push,
    "pop": _annotate_pop,
    "add": _annotate_add,
    "sub": _annotate_sub,
    "inc": _annotate_add,
    "dec": _annotate_sub,
    "cmp": _annotate_cmp,
    "test": _annotate_test,
    "xor": _annotate_xor,
    "call": _annotate_call,
    "ret": _annotate_ret,
    "jmp": _annotate_jmp,
    "syscall": _annotate_syscall,
    "lea": _annotate_lea,
    "nop": _annotate_nop,
}

# Annotations statiques pour les sauts conditionnels
STATIC_ANNOTATIONS: dict[str, str] = {
    "je": "JE — saut si égal (ZF=1).",
    "jne": "JNE — saut si différent (ZF=0).",
    "jz": "JZ — saut si zéro (ZF=1).",
    "jnz": "JNZ — saut si non-zéro (ZF=0).",
    "jl": "JL — saut si inférieur signé (SF≠OF).",
    "jle": "JLE — saut si inférieur ou égal signé (ZF=1 ou SF≠OF).",
    "jg": "JG — saut si supérieur signé (ZF=0 et SF=OF).",
    "jge": "JGE — saut si supérieur ou égal signé (SF=OF).",
    "ja": "JA — saut si supérieur non-signé (CF=0 et ZF=0).",
    "jae": "JAE — saut si supérieur ou égal non-signé (CF=0).",
    "jb": "JB — saut si inférieur non-signé (CF=1).",
    "jbe": "JBE — saut si inférieur ou égal non-signé (CF=1 ou ZF=1).",
    "and": "AND — ET logique bit à bit. Modifie ZF, SF, PF. Efface CF et OF.",
    "or": "OR — OU logique bit à bit. Modifie ZF, SF, PF. Efface CF et OF.",
    "not": "NOT — complément à un (inverse tous les bits). Ne modifie aucun flag.",
    "neg": "NEG — complément à deux (0 - opérande). Modifie tous les flags arithmétiques.",
    "shl": "SHL — décalage logique à gauche. Le bit sorti va dans CF.",
    "shr": "SHR — décalage logique à droite. Le bit sorti va dans CF.",
    "sar": "SAR — décalage arithmétique à droite. Préserve le signe.",
    "mul": "MUL — multiplication non-signée.",
    "imul": "IMUL — multiplication signée.",
    "div": "DIV — division non-signée.",
    "idiv": "IDIV — division signée.",
    "leave": "LEAVE — équivalent de MOV RSP,RBP + POP RBP. Démonte le stack frame.",
    "endbr64": "ENDBR64 — marqueur CET (Control-flow Enforcement Technology). NOP fonctionnel.",
    "cdqe": "CDQE — sign-extend EAX → RAX.",
    "cqo": "CQO — sign-extend RAX → RDX:RAX.",
}
