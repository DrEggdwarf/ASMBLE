"""
Security analysis — checksec, vmmap, GOT for ELF binaries.
Uses pyelftools (already a pwndbg dep) for static analysis.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from elftools.elf.elffile import ELFFile
from elftools.elf.sections import SymbolTableSection
from elftools.elf.relocation import RelocationSection
from elftools.elf.dynamic import DynamicSection


def checksec(binary_path: str) -> dict:
    """Analyse ELF security mitigations."""
    path = Path(binary_path)
    if not path.exists():
        return {"error": "Binary not found"}

    result: dict = {
        "relro": "No RELRO",
        "canary": False,
        "nx": False,
        "pie": False,
        "rpath": False,
        "runpath": False,
        "fortify": False,
        "stripped": True,
    }

    try:
        with open(binary_path, "rb") as f:
            elf = ELFFile(f)

            # RELRO
            has_relro_seg = False
            has_bind_now = False
            for seg in elf.iter_segments():
                if seg.header.p_type == "PT_GNU_RELRO":
                    has_relro_seg = True
            for sec in elf.iter_sections():
                if isinstance(sec, DynamicSection):
                    for tag in sec.iter_tags():
                        if tag.entry.d_tag == "DT_BIND_NOW":
                            has_bind_now = True
                        if tag.entry.d_tag == "DT_FLAGS" and tag.entry.d_val & 0x8:
                            has_bind_now = True
                        if tag.entry.d_tag == "DT_RPATH":
                            result["rpath"] = True
                        if tag.entry.d_tag == "DT_RUNPATH":
                            result["runpath"] = True

            if has_relro_seg and has_bind_now:
                result["relro"] = "Full RELRO"
            elif has_relro_seg:
                result["relro"] = "Partial RELRO"

            # NX
            for seg in elf.iter_segments():
                if seg.header.p_type == "PT_GNU_STACK":
                    result["nx"] = not bool(seg.header.p_flags & 0x1)  # PF_X
                    break

            # PIE
            result["pie"] = elf.header.e_type == "ET_DYN"

            # Stack canary + fortify (check symbol table)
            for sec in elf.iter_sections():
                if isinstance(sec, SymbolTableSection):
                    for sym in sec.iter_symbols():
                        name = sym.name
                        if "__stack_chk_fail" in name:
                            result["canary"] = True
                        if name.startswith("__") and name.endswith("_chk"):
                            result["fortify"] = True

            # Stripped
            result["stripped"] = elf.get_section_by_name(".symtab") is None

    except Exception as exc:
        result["error"] = str(exc)

    return result


def vmmap(pid: int | None, binary_path: str) -> list[dict]:
    """Read memory mappings from /proc/pid/maps or objdump."""
    entries: list[dict] = []

    if pid:
        try:
            maps_path = Path(f"/proc/{pid}/maps")
            if maps_path.exists():
                for line in maps_path.read_text().splitlines():
                    m = re.match(
                        r"([0-9a-f]+)-([0-9a-f]+)\s+(\S+)\s+\S+\s+\S+\s+\S+\s*(.*)",
                        line,
                    )
                    if m:
                        start = int(m.group(1), 16)
                        end = int(m.group(2), 16)
                        entries.append({
                            "start": start,
                            "end": end,
                            "size": end - start,
                            "perms": m.group(3),
                            "path": m.group(4).strip(),
                        })
                return entries
        except (PermissionError, FileNotFoundError):
            pass

    # Fallback: parse ELF segments
    try:
        with open(binary_path, "rb") as f:
            elf = ELFFile(f)
            for seg in elf.iter_segments():
                if seg.header.p_type in ("PT_LOAD", "PT_GNU_STACK", "PT_GNU_RELRO"):
                    flags = seg.header.p_flags
                    perms = (
                        ("r" if flags & 0x4 else "-")
                        + ("w" if flags & 0x2 else "-")
                        + ("x" if flags & 0x1 else "-")
                        + "p"
                    )
                    entries.append({
                        "start": seg.header.p_vaddr,
                        "end": seg.header.p_vaddr + seg.header.p_memsz,
                        "size": seg.header.p_memsz,
                        "perms": perms,
                        "path": seg.header.p_type,
                    })
    except Exception:
        pass

    return entries


def got_entries(binary_path: str) -> list[dict]:
    """Parse GOT/PLT entries from ELF."""
    entries: list[dict] = []

    try:
        with open(binary_path, "rb") as f:
            elf = ELFFile(f)

            # Try .rela.plt first (dynamic binaries)
            rela_plt = elf.get_section_by_name(".rela.plt")
            symtab = elf.get_section_by_name(".dynsym")

            if rela_plt and symtab and isinstance(rela_plt, RelocationSection):
                for rel in rela_plt.iter_relocations():
                    sym = symtab.get_symbol(rel["r_info_sym"])
                    entries.append({
                        "name": sym.name if sym else f"sym_{rel['r_info_sym']}",
                        "addr": rel["r_offset"],
                        "type": rel["r_info_type"],
                        "value": sym.entry.st_value if sym else 0,
                    })

            # Also check .got section directly
            got = elf.get_section_by_name(".got") or elf.get_section_by_name(".got.plt")
            if got:
                entries.append({
                    "name": ".got",
                    "addr": got.header.sh_addr,
                    "type": 0,
                    "value": got.header.sh_size,
                    "_section": True,
                })

    except Exception:
        pass

    return entries
