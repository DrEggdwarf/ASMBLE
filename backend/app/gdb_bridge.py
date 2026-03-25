"""
GDB/MI Bridge — Interface pygdbmi vers format StepSnapshot.
"""

from __future__ import annotations

import re
import time

from pygdbmi.gdbcontroller import GdbController

from .models import StepSnapshot, Flags, StackEntry, DisasmEntry, FrameInfo, SectionInfo
from .annotations import annotate


# Mapping numéro de registre GDB x86-64 → nom
# L'ordre correspond à la numérotation GDB standard pour x86-64
GDB_REG_NAMES = [
    "rax", "rbx", "rcx", "rdx", "rsi", "rdi", "rbp", "rsp",
    "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15",
    "rip", "eflags",
]


class GdbBridge:
    """Wrapper autour de pygdbmi pour piloter une session GDB."""

    def __init__(self, binary_path: str):
        self.binary_path = binary_path
        self.gdb: GdbController | None = None
        self._prev_regs: dict[str, int] = {}
        self._prev_rip: int | None = None
        self._disasm_cache: list[DisasmEntry] = []
        self._sections_cache: list[SectionInfo] = []
        self._breakpoints: dict[int, str] = {}  # line → GDB breakpoint number
        self._record_enabled: bool = False
        self._pending_output: list[str] = []  # Inferior stdout/stderr
        self._cur_ip: int = 0     # line number of current (not yet executed) instruction
        self._cur_instr: str = ""  # text of current (not yet executed) instruction
        self._exited: bool = False
        self._exit_code: int | None = None
        self._stack_cache: list[StackEntry] = []
        self._bt_cache: list[FrameInfo] = []

    def start(self) -> None:
        """Lance GDB en mode MI sur le binaire."""
        self.gdb = GdbController(
            command=["gdb", "--interpreter=mi3", "-nh", self.binary_path],
            time_to_check_for_additional_output_sec=0.05,
        )
        # Placer un breakpoint à _start et lancer
        self._write("-break-insert _start")
        resp = self._write("-exec-run")
        # Attendre que GDB soit effectivement arrêté au breakpoint
        # -exec-run return ^running immédiatement, *stopped arrive après
        self._wait_for_stop(resp)
        # record full désactivé par défaut (ralentit GDB ~100x)
        # Activé à la demande lors du premier step_back

    def read_state(self) -> StepSnapshot:
        """Lit l'état courant sans step — utile pour l'état initial."""
        snap = self._read_state()
        # Sauvegarder ip/instr pour le prochain step
        self._cur_ip = snap.ip
        self._cur_instr = snap.instr
        return snap

    def step(self) -> StepSnapshot:
        """Exécute une instruction et retourne le snapshot."""
        return self._step_and_read("-exec-next-instruction")

    def step_over(self) -> StepSnapshot:
        """Step over — ne rentre pas dans les CALL."""
        return self._step_and_read("-exec-next")

    def step_out(self) -> StepSnapshot:
        """Step out — termine la fonction courante."""
        return self._step_and_read("-exec-finish")

    def step_back(self) -> StepSnapshot:
        """Reverse step (nécessite GDB record)."""
        # Activer record au premier appel
        if not self._record_enabled:
            try:
                self._write("-interpreter-exec console \"record full\"")
                self._record_enabled = True
            except Exception:
                pass
        resp = self._write("-exec-next-instruction --reverse")
        self._wait_for_stop(resp)
        return self._step_and_read_reverse()

    def continue_exec(self) -> StepSnapshot:
        """Continue jusqu'au prochain breakpoint ou fin du programme."""
        if self._exited:
            raise RuntimeError("Programme terminé — utilisez Reset pour redémarrer.")
        resp = self._write("-exec-continue")
        self._wait_for_stop(resp)
        if self._exited:
            output = self._drain_output()
            code = self._exit_code if self._exit_code is not None else 0
            return StepSnapshot(
                ip=0, instr=f"(programme terminé, code {code})",
                regs={name: self._prev_regs.get(name, 0) for name in GDB_REG_NAMES if name != 'eflags'},
                flags=Flags(),
                changed=[], stackEntries=[],
                annotation=f"Programme terminé avec le code de sortie {code}.",
                inferiorOutput=output,
            )
        snap = self._read_state()
        self._cur_ip = snap.ip
        self._cur_instr = snap.instr
        return snap

    def add_breakpoint(self, line: int, condition: str = "") -> str:
        """Ajoute un breakpoint, optionnellement conditionnel. Retourne l'id."""
        if condition:
            cmd = f"-break-insert -c \"{condition}\" {line}"
        else:
            cmd = f"-break-insert {line}"
        resp = self._write(cmd)
        # Extraire le numéro du breakpoint pour pouvoir le supprimer
        for item in resp:
            if item.get("type") == "result" and item.get("payload"):
                bkpt = item["payload"].get("bkpt", {})
                bp_num = bkpt.get("number", "")
                if bp_num:
                    self._breakpoints[line] = bp_num
                    return bp_num
        return ""

    def remove_breakpoint(self, line: int) -> None:
        bp_num = self._breakpoints.pop(line, None)
        if bp_num:
            self._write(f"-break-delete {bp_num}")

    def read_memory(self, addr: int, size: int) -> bytes:
        """Lit `size` octets à l'adresse `addr`."""
        resp = self._write(f"-data-read-memory-bytes {addr:#x} {size}")
        return self._parse_memory_bytes(resp)

    def evaluate(self, expr: str) -> str:
        """Évalue une expression GDB."""
        resp = self._write(f"-data-evaluate-expression {expr}")
        for item in resp:
            if item.get("type") == "result" and item.get("payload"):
                return item["payload"].get("value", "")
        return ""

    def add_watchpoint(self, expr: str, kind: str = "write") -> str:
        """Ajoute un watchpoint. kind: 'write', 'read', 'access'."""
        cmd_map = {"write": "-break-watch", "read": "-break-watch -r", "access": "-break-watch -a"}
        cmd = cmd_map.get(kind, "-break-watch")
        resp = self._write(f"{cmd} {expr}")
        for item in resp:
            if item.get("type") == "result" and item.get("payload"):
                wpt = item["payload"].get("wpt", item["payload"].get("bkpt", {}))
                return wpt.get("number", "")
        return ""

    def remove_watchpoint(self, wp_id: str) -> None:
        """Supprime un watchpoint par son numéro GDB."""
        self._write(f"-break-delete {wp_id}")

    def set_register(self, reg: str, value: int) -> None:
        """Modifie la valeur d'un registre."""
        self._write(f"-gdb-set ${reg} = {value}")

    def set_args(self, args: str) -> None:
        """Définit les arguments du programme."""
        self._write(f"-exec-arguments {args}")

    def gdb_command(self, cmd: str) -> str:
        """Exécute une commande GDB brute et retourne la sortie."""
        escaped = cmd.replace('\\', '\\\\').replace('"', '\\"')
        resp = self._write(f'-interpreter-exec console "{escaped}"')
        lines: list[str] = []
        for item in resp:
            if item.get("type") == "console":
                lines.append(item.get("payload", "").rstrip("\n"))
        return "\n".join(lines)

    def get_backtrace(self) -> list[FrameInfo]:
        """Retourne la pile d'appels."""
        resp = self._write("-stack-list-frames")
        frames: list[FrameInfo] = []
        for item in resp:
            if item.get("type") == "result" and item.get("payload"):
                for f in item["payload"].get("stack", []):
                    frame = f.get("frame", f)
                    frames.append(FrameInfo(
                        level=int(frame.get("level", 0)),
                        addr=int(frame.get("addr", "0"), 0),
                        func=frame.get("func", "??"),
                        file=frame.get("file", ""),
                        line=int(frame.get("line", 0)),
                    ))
        return frames

    def get_sections(self) -> list[SectionInfo]:
        """Découvre les sections ELF via 'info files'."""
        if self._sections_cache:
            return self._sections_cache
        try:
            output = self.gdb_command("info files")
            sections: list[SectionInfo] = []
            for line in output.split("\n"):
                m = re.match(r"\s*(0x[0-9a-f]+)\s*-\s*(0x[0-9a-f]+)\s+is\s+(\.\w+)", line, re.I)
                if m:
                    start = int(m.group(1), 16)
                    end = int(m.group(2), 16)
                    name = m.group(3)
                    sections.append(SectionInfo(
                        name=name, start=start, end=end, size=end - start,
                    ))
            self._sections_cache = sections
            return sections
        except Exception:
            return []

    def read_section_data(self, section_name: str) -> list[dict]:
        """Lit le contenu d'une section (.data, .bss) en mots de 8 octets."""
        sections = self.get_sections()
        sec = next((s for s in sections if s.name == section_name), None)
        if not sec or sec.size == 0 or sec.size > 4096:
            return []
        raw = self.read_memory(sec.start, sec.size)
        if not raw:
            return []
        entries = []
        for i in range(0, len(raw), 8):
            chunk = raw[i:i + 8]
            val = int.from_bytes(chunk.ljust(8, b'\x00'), "little")
            entries.append({"addr": sec.start + i, "val": val})
        return entries

    def cleanup(self) -> None:
        """Termine la session GDB proprement."""
        if self.gdb:
            try:
                self.gdb.exit()
            except Exception:
                pass
            self.gdb = None

    # ── Internals ──────────────────────────────────

    def _step_and_read(self, exec_cmd: str) -> StepSnapshot:
        """Exécute une commande d'avancement, retourne un snapshot
        dont ip/instr = l'instruction qui vient de s'exécuter (pré-step),
        et changed/regs = l'état APRÈS l'exécution."""
        if self._exited:
            raise RuntimeError("Programme terminé — utilisez Reset pour redémarrer.")
        # Sauvegarder l'instruction qui va s'exécuter
        pre_ip = self._cur_ip
        pre_instr = self._cur_instr

        resp = self._write(exec_cmd)
        self._wait_for_stop(resp)
        snap = self._read_state()

        # Le snapshot renvoie ip/instr de l'instruction qui VIENT de s'exécuter
        # (pas la prochaine), pour que changed corresponde à l'instruction affichée
        executed_snap = snap.model_copy(update={
            "ip": pre_ip,
            "instr": pre_instr,
        })
        # Annotation basée sur l'instruction exécutée
        executed_snap.annotation = annotate(pre_instr, dict(snap.regs), snap.flags)
        executed_snap.flagHint = self._generate_flag_hint(pre_instr, snap.flags)

        # Mettre à jour l'état courant pour le prochain step
        self._cur_ip = snap.ip
        self._cur_instr = snap.instr

        return executed_snap

    def _step_and_read_reverse(self) -> StepSnapshot:
        """Après un reverse step, lire l'état (pour reverse debug)."""
        snap = self._read_state()
        self._cur_ip = snap.ip
        self._cur_instr = snap.instr
        return snap

    def _wait_for_stop(self, initial_resp: list[dict], timeout: float = 10) -> None:
        """Attend que GDB signale *stopped ou program exit."""
        # Vérifier si *stopped ou ^error est déjà dans la réponse initiale
        for item in initial_resp:
            if self._check_stop_or_exit(item):
                return
            if item.get("type") == "result" and item.get("message") == "error":
                raise RuntimeError(item.get("payload", {}).get("msg", "GDB error"))
        # Sinon, lire la sortie GDB jusqu'à *stopped (max timeout)
        assert self.gdb is not None
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                more = self.gdb.get_gdb_response(timeout_sec=0.1, raise_error_on_timeout=False)
                for item in more:
                    self._capture_output(item)
                    if self._check_stop_or_exit(item):
                        return
                    if item.get("type") == "result" and item.get("message") == "error":
                        raise RuntimeError(item.get("payload", {}).get("msg", "GDB error"))
            except RuntimeError:
                raise
            except Exception:
                break
            time.sleep(0.01)

    def _check_stop_or_exit(self, item: dict) -> bool:
        """Vérifie si l'item indique un arrêt ou une sortie du programme."""
        if item.get("message") == "stopped":
            payload = item.get("payload", {})
            reason = payload.get("reason", "") if isinstance(payload, dict) else ""
            if reason in ("exited-normally", "exited", "exited-signalled"):
                self._exited = True
                exit_code = payload.get("exit-code", "0") if isinstance(payload, dict) else "0"
                try:
                    self._exit_code = int(exit_code, 8) if exit_code.startswith("0") and len(exit_code) > 1 else int(exit_code)
                except (ValueError, TypeError):
                    self._exit_code = 0
            return True
        return False

    def _capture_output(self, item: dict) -> None:
        """Capture la sortie programme (inferior stdout/stderr)."""
        msg_type = item.get("type")
        payload = item.get("payload", "")
        if msg_type == "output" or msg_type == "target":
            text = str(payload).strip()
            if text:
                self._pending_output.append(text)

    def _write(self, cmd: str) -> list[dict]:
        """Envoie une commande GDB/MI et retourne la réponse."""
        assert self.gdb is not None, "GDB not started"
        resp = self.gdb.write(cmd, timeout_sec=5)
        for item in resp:
            self._capture_output(item)
        return resp

    def _drain_output(self) -> list[str]:
        """Vide et retourne la sortie programme accumulée."""
        out = list(self._pending_output)
        self._pending_output.clear()
        return out

    def _read_state(self) -> StepSnapshot:
        """Lit l'état complet de GDB et construit un StepSnapshot."""

        # Registres
        reg_resp = self._write("-data-list-register-values x")
        regs = self._parse_registers(reg_resp)

        # Garantir que tous les registres attendus sont présents
        for name in GDB_REG_NAMES:
            regs.setdefault(name, 0)

        # Flags depuis EFLAGS
        eflags_val = regs.get("eflags", 0)
        flags = Flags(
            ZF=bool((eflags_val >> 6) & 1),
            CF=bool(eflags_val & 1),
            SF=bool((eflags_val >> 7) & 1),
            OF=bool((eflags_val >> 11) & 1),
            PF=bool((eflags_val >> 2) & 1),
            AF=bool((eflags_val >> 4) & 1),
            DF=bool((eflags_val >> 10) & 1),
        )

        # Registres modifiés (vide au premier appel = état initial)
        if not self._prev_regs:
            changed: list[str] = []
        else:
            changed = [
                name for name, val in regs.items()
                if self._prev_regs.get(name) != val
            ]
        self._prev_regs = dict(regs)

        # Stack — skip si RSP n'a pas changé
        rsp = regs.get("rsp", 0)
        rbp = regs.get("rbp", 0)
        if 'rsp' in changed or not self._stack_cache:
            self._stack_cache = self._read_stack(rsp, rbp)
        stack_entries = self._stack_cache

        # Frame info
        frame_resp = self._write("-stack-info-frame")
        ip = self._parse_line_number(frame_resp)

        # Instruction courante — lookup from cache if possible
        rip = regs.get("rip", 0)
        instr = ""
        if self._disasm_cache:
            for entry in self._disasm_cache:
                if entry.addr == rip:
                    instr = entry.instr
                    break
        if not instr:
            instr = self._parse_current_instruction()

        # Détection de saut : RIP n'a pas avancé séquentiellement
        jumped = False
        if self._prev_rip is not None and rip != 0:
            # Un saut = RIP n'est pas à prev_rip + taille instruction précédente
            # Approximation simple : si diff > 16 ou négative, c'est un saut
            diff = rip - self._prev_rip
            if diff < 0 or diff > 15:
                jumped = True
        self._prev_rip = rip

        # Annotation pédagogique
        annotation = annotate(instr, regs, flags)

        # Flag hint contextuel
        flag_hint = self._generate_flag_hint(instr, flags)

        # Désassemblage complet (caché après le premier appel)
        if not self._disasm_cache:
            self._disasm_cache = self._disassemble_text()

        # Backtrace : skip on every step, only re-fetch if stack changed
        if not self._bt_cache or 'rsp' in changed or 'rbp' in changed:
            self._bt_cache = self.get_backtrace()
        backtrace = self._bt_cache

        # Sections ELF (already cached internally)
        sections = self.get_sections()

        # Sortie programme
        inferior_output = self._drain_output()

        return StepSnapshot(
            ip=ip,
            instr=instr,
            regs={k: v for k, v in regs.items() if k != "eflags"},
            flags=flags,
            changed=[c for c in changed if c != "eflags"],
            stackEntries=stack_entries,
            annotation=annotation,
            jumped=jumped,
            flagHint=flag_hint,
            disassembly=self._disasm_cache,
            backtrace=backtrace,
            sections=sections,
            inferiorOutput=inferior_output,
        )

    def _parse_registers(self, response: list[dict]) -> dict[str, int]:
        """Parse la réponse -data-list-register-values."""
        regs: dict[str, int] = {}
        for item in response:
            if item.get("type") == "result" and item.get("payload"):
                payload = item["payload"]
                if "register-values" in payload:
                    for rv in payload["register-values"]:
                        num = int(rv["number"])
                        if num < len(GDB_REG_NAMES):
                            name = GDB_REG_NAMES[num]
                            try:
                                regs[name] = int(rv["value"], 16)
                            except ValueError:
                                regs[name] = int(rv["value"], 0)
        return regs

    def _parse_memory_bytes(self, response: list[dict]) -> bytes:
        """Parse la réponse -data-read-memory-bytes en bytes."""
        for item in response:
            if item.get("type") == "result" and item.get("payload"):
                memory = item["payload"].get("memory", [])
                if memory:
                    hex_str = memory[0].get("contents", "")
                    return bytes.fromhex(hex_str)
        return b""

    def _read_stack(self, rsp: int, rbp: int, depth: int = 16) -> list[StackEntry]:
        """Lit la stack depuis RSP sur `depth` slots de 8 octets."""
        if rsp == 0:
            return []

        size = depth * 8
        raw = self.read_memory(rsp, size)
        if not raw:
            return []

        entries: list[StackEntry] = []
        for i in range(0, min(len(raw), size), 8):
            addr = rsp + i
            val = int.from_bytes(raw[i:i + 8], "little") if i + 8 <= len(raw) else 0

            # Labels sémantiques
            label = ""
            is_rsp = (addr == rsp and i == 0)
            is_rbp = (addr == rbp)
            if is_rsp:
                label = "RSP →"
            if is_rbp:
                label = "RBP →" if not is_rsp else "RSP/RBP →"
            if rbp and addr > rbp:
                offset = addr - rbp
                label = f"[RBP+{offset}]"
            elif rbp and addr < rbp and addr >= rsp:
                offset = rbp - addr
                label = f"[RBP-{offset}]"

            entries.append(StackEntry(
                addr=addr,
                val=val,
                label=label,
                isRsp=is_rsp,
                isRbp=is_rbp,
            ))
        # Highest address first (matches UI: "Adresses hautes" at top)
        entries.reverse()
        return entries

    def _parse_line_number(self, response: list[dict]) -> int:
        """Extrait le numéro de ligne depuis -stack-info-frame."""
        for item in response:
            if item.get("type") == "result" and item.get("payload"):
                frame = item["payload"].get("frame", {})
                return int(frame.get("line", 0))
        return 0

    def _parse_current_instruction(self) -> str:
        """Désassemble l'instruction courante."""
        resp = self._write("-data-disassemble -s $pc -e $pc+16 -- 0")
        for item in resp:
            if item.get("type") == "result" and item.get("payload"):
                asm_insns = item["payload"].get("asm_insns", [])
                if asm_insns:
                    return asm_insns[0].get("inst", "")
        return ""

    def _disassemble_text(self) -> list[DisasmEntry]:
        """Désassemble la section .text complète via info sur _start."""
        try:
            # Obtenir l'adresse de _start
            resp = self._write("-data-evaluate-expression &_start")
            start_addr = 0
            for item in resp:
                if item.get("type") == "result" and item.get("payload"):
                    val = item["payload"].get("value", "")
                    start_addr = int(val.split()[0], 0) if val else 0

            if start_addr == 0:
                return []

            # Désassembler un bloc raisonnable (512 octets max)
            end_addr = start_addr + 512
            resp = self._write(f"-data-disassemble -s {start_addr:#x} -e {end_addr:#x} -- 0")

            entries: list[DisasmEntry] = []
            for item in resp:
                if item.get("type") == "result" and item.get("payload"):
                    for insn in item["payload"].get("asm_insns", []):
                        addr = int(insn.get("address", "0"), 0)
                        inst = insn.get("inst", "")
                        # Lire les octets de l'instruction
                        offset = insn.get("offset", "")
                        func = insn.get("func-name", "")
                        label = f"{func}+{offset}:" if func and offset != "0" else (f"{func}:" if func else "")
                        entries.append(DisasmEntry(
                            addr=addr,
                            instr=inst,
                            label=label if entries == [] or label.endswith("+0:") or not label.endswith(":") else "",
                        ))
            # Mettre le label sur la première instruction de chaque fonction
            seen_funcs: set[str] = set()
            for e in entries:
                if e.label and "+" not in e.label:
                    if e.label in seen_funcs:
                        e.label = ""
                    else:
                        seen_funcs.add(e.label)
            return entries
        except Exception:
            return []

    @staticmethod
    def _generate_flag_hint(instr: str, flags: Flags) -> str:
        """Génère un hint contextuel basé sur les flags et l'instruction suivante."""
        if not instr:
            return ""

        parts = instr.strip().split(None, 1)
        mnemonic = parts[0].lower()

        # Après un CMP/TEST, indiquer ce que les sauts conditionnels feraient
        JUMP_CONDITIONS = {
            "je": flags.ZF, "jz": flags.ZF,
            "jne": not flags.ZF, "jnz": not flags.ZF,
            "jl": flags.SF != flags.OF, "jnge": flags.SF != flags.OF,
            "jle": flags.ZF or (flags.SF != flags.OF),
            "jg": not flags.ZF and (flags.SF == flags.OF),
            "jge": flags.SF == flags.OF, "jnl": flags.SF == flags.OF,
            "ja": not flags.CF and not flags.ZF,
            "jae": not flags.CF, "jnb": not flags.CF,
            "jb": flags.CF, "jnae": flags.CF,
            "jbe": flags.CF or flags.ZF,
        }

        if mnemonic in JUMP_CONDITIONS:
            taken = JUMP_CONDITIONS[mnemonic]
            return f"{'⚡ Saut pris' if taken else '→ Saut non pris'} (ZF={int(flags.ZF)} CF={int(flags.CF)} SF={int(flags.SF)} OF={int(flags.OF)})"

        if mnemonic in ("cmp", "test"):
            hints = []
            if flags.ZF:
                hints.append("égaux (ZF=1)")
            if flags.CF:
                hints.append("< non-signé (CF=1)")
            if flags.SF != flags.OF:
                hints.append("< signé (SF≠OF)")
            if not hints:
                hints.append("> (ZF=0, CF=0)")
            return "Résultat : " + ", ".join(hints)

        return ""
