// ─── SAMPLE CODE ─────────────────────────────────────────────────────────────

export interface CodeLine {
  line: number
  label: string
  indent: number
  type: 'section' | 'directive' | 'label' | 'instr' | 'empty'
}

export const SAMPLE_CODE: CodeLine[] = [
  { line: 1,  label: 'section .text', indent: 0, type: 'section' },
  { line: 2,  label: 'global _start', indent: 0, type: 'directive' },
  { line: 3,  label: '',              indent: 0, type: 'empty' },
  { line: 4,  label: '_start:',       indent: 0, type: 'label' },
  { line: 5,  label: 'mov rax, 5',    indent: 2, type: 'instr' },
  { line: 6,  label: 'mov rbx, 3',    indent: 2, type: 'instr' },
  { line: 7,  label: 'add rax, rbx',  indent: 2, type: 'instr' },
  { line: 8,  label: 'cmp rax, 10',   indent: 2, type: 'instr' },
  { line: 9,  label: 'jle done',      indent: 2, type: 'instr' },
  { line: 10, label: 'sub rax, rbx',  indent: 2, type: 'instr' },
  { line: 11, label: '',              indent: 0, type: 'empty' },
  { line: 12, label: 'done:',         indent: 0, type: 'label' },
  { line: 13, label: 'mov rdi, rax',  indent: 2, type: 'instr' },
  { line: 14, label: 'mov rax, 60',   indent: 2, type: 'instr' },
  { line: 15, label: 'syscall',       indent: 2, type: 'instr' },
]

// ─── STEPS (mock snapshots) ──────────────────────────────────────────────────

export interface StepSnapshot {
  ip: number
  instr: string | null
  regs: Record<string, number>
  flags: Record<string, number>
  changed: string[]
  stackEntries: { addr: number; val: number }[]
  annotation: string
  jumped?: boolean
}

const BASE_RSP = 0x7ffd1000
const BASE_RBP = 0x7ffd1018

const baseRegs = { rax: 0, rbx: 0, rcx: 0, rdx: 0, rsi: 0, rdi: 0, rsp: BASE_RSP, rbp: BASE_RBP, rip: 0x401000, r8: 0, r9: 0, r10: 0, r11: 0, r12: 0, r13: 0, r14: 0, r15: 0 }
const baseStack = [
  { addr: BASE_RBP, val: 0 },
  { addr: BASE_RSP + 16, val: 1 },
  { addr: BASE_RSP + 8, val: 0x7ffd1284 },
  { addr: BASE_RSP, val: 0 },
]

export const STEPS: StepSnapshot[] = [
  { ip: 5,  instr: null,            regs: { ...baseRegs },                                    flags: { ZF: 0, CF: 0, SF: 0, OF: 0 }, changed: [],              stackEntries: baseStack, annotation: 'Début du programme — tous les registres à zéro.' },
  { ip: 6,  instr: 'mov rax, 5',    regs: { ...baseRegs, rax: 5, rip: 0x401005 },             flags: { ZF: 0, CF: 0, SF: 0, OF: 0 }, changed: ['rax', 'rip'],  stackEntries: baseStack, annotation: 'MOV rax, 5 → RAX = 5. Aucun flag affecté.' },
  { ip: 7,  instr: 'mov rbx, 3',    regs: { ...baseRegs, rax: 5, rbx: 3, rip: 0x40100a },     flags: { ZF: 0, CF: 0, SF: 0, OF: 0 }, changed: ['rbx', 'rip'],  stackEntries: baseStack, annotation: 'MOV rbx, 3 → RBX = 3.' },
  { ip: 8,  instr: 'add rax, rbx',  regs: { ...baseRegs, rax: 8, rbx: 3, rip: 0x40100d },     flags: { ZF: 0, CF: 0, SF: 0, OF: 0 }, changed: ['rax', 'rip'],  stackEntries: baseStack, annotation: 'ADD rax, rbx → RAX = 5 + 3 = 8.' },
  { ip: 9,  instr: 'cmp rax, 10',   regs: { ...baseRegs, rax: 8, rbx: 3, rip: 0x401011 },     flags: { ZF: 0, CF: 0, SF: 1, OF: 0 }, changed: ['rip'],         stackEntries: baseStack, annotation: 'CMP rax, 10 → 8−10 = −2. SF=1 (résultat négatif).' },
  { ip: 13, instr: 'jle done',      regs: { ...baseRegs, rax: 8, rbx: 3, rip: 0x401019 },     flags: { ZF: 0, CF: 0, SF: 1, OF: 0 }, changed: ['rip'],         stackEntries: baseStack, annotation: 'JLE done → SF≠OF → condition vraie → SAUT pris.', jumped: true },
]

// ─── C → ASM PATTERNS ────────────────────────────────────────────────────────

export interface CPattern {
  category: string
  label: string
  c: string
  asm: string
  note?: string
}

export const C_PATTERNS: CPattern[] = [
  { category: 'Affectation', label: 'a = b', c: 'int a = 5;\nint b = a;', asm: 'mov rax, 5      ; rax = a = 5\nmov rbx, rax    ; rbx = b = a', note: 'MOV ne modifie aucun flag.' },
  { category: 'Arithmétique', label: 'a + b', c: 'int c = a + b;', asm: 'mov rax, a\nadd rax, b      ; rax = a + b\n; résultat dans rax', note: 'ADD modifie ZF, SF, CF, OF.' },
  { category: 'Arithmétique', label: 'a % b (modulo)', c: 'int r = a % b;', asm: 'mov rax, a      ; dividende dans rax\ncqo             ; sign-extend rax → rdx:rax\nidiv rbx        ; divise rdx:rax par rbx\n; quotient → rax\n; reste    → rdx  ← c\'est ton modulo', note: 'CQO est obligatoire avant IDIV signé — il propage le bit de signe de RAX dans tout RDX. Oubli fréquent.' },
  { category: 'Arithmétique', label: 'a * b', c: 'int c = a * b;', asm: 'mov rax, a\nimul rax, rbx   ; rax = rax * rbx\n; résultat 64-bit dans rax\n; overflow silencieux si > 64 bits', note: 'IMUL 2 opérandes garde seulement les 64 bits bas. MUL (non signé) met le résultat dans RDX:RAX.' },
  { category: 'Condition', label: 'if (a == b)', c: 'if (a == b) {\n  // ...\n}', asm: 'cmp rax, rbx    ; soustraction implicite\njne end_if      ; saute si ≠ (ZF=0)\n  ; corps du if\nend_if:', note: 'CMP fait a−b sans stocker. JNE saute si ZF=0. Logique inversée : on saute HORS du bloc.' },
  { category: 'Condition', label: 'if (a < b) signé', c: 'if (a < b) {\n  // ...\n}', asm: 'cmp rax, rbx\njge end_if      ; saute si ≥ (SF==OF)\n  ; corps du if\nend_if:', note: 'JL = jump if less = SF≠OF. JGE est son contraire. Pour non-signé : JB/JAE (utilise CF).' },
  { category: 'Condition', label: 'if / else', c: 'if (a > 0) {\n  x = 1;\n} else {\n  x = 2;\n}', asm: 'cmp rax, 0\njle else_branch ; ≤ 0 → else\n  mov rbx, 1\n  jmp end_if\nelse_branch:\n  mov rbx, 2\nend_if:', note: 'Le JMP après le bloc if est nécessaire pour sauter le else.' },
  { category: 'Boucles', label: 'for (i=0; i<n; i++)', c: 'for (int i = 0; i < n; i++) {\n  // ...\n}', asm: 'mov rcx, 0      ; i = 0\nloop_start:\n  cmp rcx, n\n  jge loop_end    ; i >= n → sort\n  ; corps de la boucle\n  inc rcx         ; i++\n  jmp loop_start\nloop_end:', note: 'INC ne modifie pas CF (contrairement à ADD rcx,1). RCX est le registre de compteur traditionnel.' },
  { category: 'Boucles', label: 'while (cond)', c: 'while (a != 0) {\n  a--;\n}', asm: 'while_start:\n  cmp rax, 0\n  je  while_end   ; a == 0 → sort\n  dec rax         ; a--\n  jmp while_start\nwhile_end:', note: 'Identique au for — la condition est testée en haut. DEC ne modifie pas CF.' },
  { category: 'Boucles', label: 'do { } while', c: 'do {\n  a--;\n} while (a != 0);', asm: 'do_start:\n  dec rax         ; a--\n  cmp rax, 0\n  jne do_start    ; recommence si a ≠ 0', note: 'Corps exécuté au moins une fois. La condition est testée en bas — plus efficace si souvent vrai.' },
  { category: 'Boucles', label: 'LOOP (compteur)', c: 'for (int i = n; i > 0; i--) { }', asm: 'mov rcx, n      ; compteur dans RCX obligatoire\nloop_start:\n  ; corps\n  loop loop_start ; DEC rcx, JNZ loop_start', note: "L'instruction LOOP est un raccourci : décrémente RCX et saute si RCX≠0. Limité à RCX." },
  { category: 'Fonctions', label: 'appel de fonction', c: 'int result = foo(a, b);', asm: '; Convention SysV AMD64 :\n; args 1-6 → rdi, rsi, rdx, rcx, r8, r9\nmov rdi, a      ; 1er argument\nmov rsi, b      ; 2ème argument\ncall foo        ; push rip+1, jmp foo\n; retour dans rax', note: 'CALL pousse l\'adresse de retour sur la stack puis saute. RET la dépile et y retourne.' },
  { category: 'Fonctions', label: 'prologue / épilogue', c: 'int foo() {\n  int x = 1;\n  return x;\n}', asm: 'foo:\n  push rbp        ; sauvegarde base pointer\n  mov  rbp, rsp   ; nouveau frame\n  sub  rsp, 16    ; réserve espace local\n\n  mov dword [rbp-4], 1  ; x = 1\n  mov eax, [rbp-4]      ; return x\n\n  leave           ; mov rsp,rbp + pop rbp\n  ret', note: 'LEAVE = MOV rsp, rbp + POP rbp. Toujours sauvegarder RBP au début et le restaurer avant RET.' },
  { category: 'Bits / logique', label: 'a & b (AND)', c: 'int c = a & b;', asm: 'mov rax, a\nand rax, b      ; rax = a & b\n; ZF=1 si résultat == 0', note: 'Utile pour masquer des bits : AND rax, 0xFF garde seulement l\'octet bas.' },
  { category: 'Bits / logique', label: 'a | b (OR)', c: 'int c = a | b;', asm: 'mov rax, a\nor  rax, b      ; rax = a | b', note: 'Utile pour setter des bits : OR rax, 0x80 met le bit 7 à 1.' },
  { category: 'Bits / logique', label: 'a ^ b (XOR)', c: 'int c = a ^ b;', asm: 'mov rax, a\nxor rax, b      ; rax = a ^ b\n\n; Astuce : xor rax, rax  → rax = 0\n; plus rapide que mov rax, 0', note: "XOR reg, reg est l'idiome classique pour mettre un registre à zéro — 1 byte de moins qu'un MOV." },
  { category: 'Bits / logique', label: 'a << n (shift left)', c: 'int c = a << 2;', asm: 'mov rax, a\nshl rax, 2      ; rax = a * 4\n; shl n == multiply by 2^n', note: 'SHL est équivalent à une multiplication par une puissance de 2 — beaucoup plus rapide.' },
  { category: 'Bits / logique', label: 'a >> n (shift right)', c: 'int c = a >> 2;  // signé', asm: "mov rax, a\nsar rax, 2      ; arithmetic shift (préserve le signe)\n; sar vs shr :\n; sar = signé  (remplit avec bit de signe)\n; shr = non signé (remplit avec 0)", note: 'SAR pour entiers signés, SHR pour non-signés. Différence critique sur les valeurs négatives.' },
]

// ─── LEXICON ─────────────────────────────────────────────────────────────────

export interface LexiconInstr {
  cat: string
  name: string
  syntax: string
  desc: string
}

export const LEXICON_INSTRS: LexiconInstr[] = [
  { cat: 'Données', name: 'MOV', syntax: 'mov dst, src', desc: 'Copie src dans dst. Ne modifie aucun flag.' },
  { cat: 'Données', name: 'MOVZX', syntax: 'movzx dst, src', desc: 'Copie src dans dst avec zero-extension (remplit le reste avec 0).' },
  { cat: 'Données', name: 'MOVSX', syntax: 'movsx dst, src', desc: 'Copie src dans dst avec sign-extension (propage le bit de signe).' },
  { cat: 'Données', name: 'LEA', syntax: 'lea dst, [expr]', desc: "Load Effective Address : calcule l'adresse sans déréférencer. Utile pour arithmétique d'adresses." },
  { cat: 'Données', name: 'PUSH', syntax: 'push src', desc: 'Décrémente RSP de 8, écrit src à [RSP]. Modifie RSP.' },
  { cat: 'Données', name: 'POP', syntax: 'pop dst', desc: 'Lit [RSP] dans dst, incrémente RSP de 8.' },
  { cat: 'Données', name: 'XCHG', syntax: 'xchg a, b', desc: 'Échange les valeurs de a et b atomiquement.' },
  { cat: 'Arithmétique', name: 'ADD', syntax: 'add dst, src', desc: 'dst = dst + src. Modifie ZF, SF, CF, OF.' },
  { cat: 'Arithmétique', name: 'SUB', syntax: 'sub dst, src', desc: 'dst = dst - src. Modifie ZF, SF, CF, OF.' },
  { cat: 'Arithmétique', name: 'INC', syntax: 'inc dst', desc: 'dst++. Modifie ZF, SF, OF — pas CF.' },
  { cat: 'Arithmétique', name: 'DEC', syntax: 'dec dst', desc: 'dst--. Modifie ZF, SF, OF — pas CF.' },
  { cat: 'Arithmétique', name: 'IMUL', syntax: 'imul dst, src', desc: 'Multiplication signée. 2 opérandes : résultat dans dst (64 bits bas).' },
  { cat: 'Arithmétique', name: 'MUL', syntax: 'mul src', desc: 'Multiplication non signée. RAX * src → résultat dans RDX:RAX.' },
  { cat: 'Arithmétique', name: 'IDIV', syntax: 'idiv src', desc: 'Division signée de RDX:RAX par src. Quotient → RAX, reste → RDX. Nécessite CQO avant.' },
  { cat: 'Arithmétique', name: 'DIV', syntax: 'div src', desc: 'Division non signée de RDX:RAX par src. Quotient → RAX, reste → RDX.' },
  { cat: 'Arithmétique', name: 'NEG', syntax: 'neg dst', desc: 'Complément à deux : dst = 0 - dst.' },
  { cat: 'Arithmétique', name: 'CQO', syntax: 'cqo', desc: 'Sign-extend RAX dans RDX:RAX. Obligatoire avant IDIV 64-bit.' },
  { cat: 'Arithmétique', name: 'CDQ', syntax: 'cdq', desc: 'Sign-extend EAX dans EDX:EAX. Équivalent 32-bit de CQO.' },
  { cat: 'Logique', name: 'AND', syntax: 'and dst, src', desc: 'Bitwise AND. Met ZF=1 si résultat=0. Utile pour masquer des bits.' },
  { cat: 'Logique', name: 'OR', syntax: 'or dst, src', desc: 'Bitwise OR. Pour setter des bits.' },
  { cat: 'Logique', name: 'XOR', syntax: 'xor dst, src', desc: 'Bitwise XOR. xor reg, reg est l\'idiome pour mettre à zéro.' },
  { cat: 'Logique', name: 'NOT', syntax: 'not dst', desc: 'Inverse tous les bits (complément à un). Ne modifie pas les flags.' },
  { cat: 'Logique', name: 'TEST', syntax: 'test a, b', desc: 'AND implicite sans stocker. Utilisé pour tester des bits : test rax, rax vérifie si rax==0.' },
  { cat: 'Logique', name: 'SHL', syntax: 'shl dst, n', desc: 'Shift left logique. Equivalent à dst * 2^n. Remplit avec 0 à droite.' },
  { cat: 'Logique', name: 'SHR', syntax: 'shr dst, n', desc: 'Shift right logique (non signé). Remplit avec 0 à gauche.' },
  { cat: 'Logique', name: 'SAR', syntax: 'sar dst, n', desc: 'Shift right arithmétique (signé). Préserve le bit de signe.' },
  { cat: 'Logique', name: 'ROL', syntax: 'rol dst, n', desc: 'Rotate left. Les bits qui sortent à gauche rentrent à droite.' },
  { cat: 'Logique', name: 'ROR', syntax: 'ror dst, n', desc: 'Rotate right.' },
  { cat: 'Sauts', name: 'CMP', syntax: 'cmp a, b', desc: 'Soustraction implicite a−b sans stocker. Met à jour ZF, SF, CF, OF.' },
  { cat: 'Sauts', name: 'JMP', syntax: 'jmp label', desc: 'Saut inconditionnel.' },
  { cat: 'Sauts', name: 'JE/JZ', syntax: 'je label', desc: 'Saute si ZF=1 (égal / zéro).' },
  { cat: 'Sauts', name: 'JNE/JNZ', syntax: 'jne label', desc: 'Saute si ZF=0 (différent / non zéro).' },
  { cat: 'Sauts', name: 'JL/JNGE', syntax: 'jl label', desc: 'Saute si SF≠OF (inférieur signé).' },
  { cat: 'Sauts', name: 'JLE/JNG', syntax: 'jle label', desc: 'Saute si ZF=1 ou SF≠OF (inférieur ou égal signé).' },
  { cat: 'Sauts', name: 'JG/JNLE', syntax: 'jg label', desc: 'Saute si ZF=0 et SF=OF (supérieur signé).' },
  { cat: 'Sauts', name: 'JGE/JNL', syntax: 'jge label', desc: 'Saute si SF=OF (supérieur ou égal signé).' },
  { cat: 'Sauts', name: 'JB/JNAE', syntax: 'jb label', desc: 'Saute si CF=1 (inférieur non signé — Below).' },
  { cat: 'Sauts', name: 'JA/JNBE', syntax: 'ja label', desc: 'Saute si CF=0 et ZF=0 (supérieur non signé — Above).' },
  { cat: 'Sauts', name: 'JS', syntax: 'js label', desc: 'Saute si SF=1 (résultat négatif).' },
  { cat: 'Sauts', name: 'JO', syntax: 'jo label', desc: 'Saute si OF=1 (overflow).' },
  { cat: 'Sauts', name: 'LOOP', syntax: 'loop label', desc: 'DEC RCX + JNZ label. Boucle tant que RCX≠0.' },
  { cat: 'Fonctions', name: 'CALL', syntax: 'call label', desc: "PUSH RIP+taille_instr puis JMP label. Sauvegarde l'adresse de retour." },
  { cat: 'Fonctions', name: 'RET', syntax: 'ret', desc: "POP RIP. Retourne à l'appelant." },
  { cat: 'Fonctions', name: 'LEAVE', syntax: 'leave', desc: 'MOV RSP, RBP puis POP RBP. Épilogue standard.' },
  { cat: 'Fonctions', name: 'ENTER', syntax: 'enter n, 0', desc: 'Prologue : PUSH RBP, MOV RBP RSP, SUB RSP n. Rarement utilisé.' },
  { cat: 'Système', name: 'SYSCALL', syntax: 'syscall', desc: 'Appel système Linux (x86-64). Numéro dans RAX, args dans RDI RSI RDX R10 R8 R9.' },
  { cat: 'Système', name: 'NOP', syntax: 'nop', desc: "No Operation. 1 cycle. Utilisé pour l'alignement ou les patches." },
  { cat: 'Système', name: 'HLT', syntax: 'hlt', desc: "Halt — arrête le CPU jusqu'à une interruption. Niveau kernel uniquement." },
  { cat: 'Système', name: 'INT', syntax: 'int n', desc: "Déclenche l'interruption n. int 0x80 = ancienne ABI syscall 32-bit." },
  { cat: 'Système', name: 'CPUID', syntax: 'cpuid', desc: 'Identifie le CPU. EAX=type de requête, résultat dans EAX/EBX/ECX/EDX.' },
]

export interface Syscall {
  num: number
  name: string
  args: string
  desc: string
}

export const SYSCALLS: Syscall[] = [
  { num: 0,   name: 'read',       args: 'rdi=fd, rsi=buf, rdx=count',   desc: 'Lit count octets depuis fd dans buf.' },
  { num: 1,   name: 'write',      args: 'rdi=fd, rsi=buf, rdx=count',   desc: 'Écrit count octets de buf vers fd. fd=1 → stdout, fd=2 → stderr.' },
  { num: 2,   name: 'open',       args: 'rdi=path, rsi=flags, rdx=mode', desc: 'Ouvre un fichier. Retourne un fd.' },
  { num: 3,   name: 'close',      args: 'rdi=fd',                        desc: 'Ferme le fd.' },
  { num: 9,   name: 'mmap',       args: 'rdi=addr, rsi=len, rdx=prot',  desc: "Map mémoire. Base de l'exploitation heap/shellcode." },
  { num: 11,  name: 'munmap',     args: 'rdi=addr, rsi=len',             desc: 'Unmap une région mémoire.' },
  { num: 12,  name: 'brk',        args: 'rdi=addr',                      desc: 'Modifie la fin du segment data. Base de malloc().' },
  { num: 39,  name: 'getpid',     args: '(aucun)',                        desc: 'Retourne le PID du processus courant dans RAX.' },
  { num: 57,  name: 'fork',       args: '(aucun)',                        desc: "Duplique le processus. Retourne 0 dans l'enfant, PID dans le parent." },
  { num: 59,  name: 'execve',     args: 'rdi=path, rsi=argv, rdx=envp',  desc: 'Exécute un programme. Base du shellcode classique.' },
  { num: 60,  name: 'exit',       args: 'rdi=code',                      desc: 'Termine le processus avec code de sortie.' },
  { num: 61,  name: 'wait4',      args: 'rdi=pid, rsi=status',           desc: "Attend la fin d'un processus fils." },
  { num: 102, name: 'getuid',     args: '(aucun)',                        desc: "Retourne l'UID réel." },
  { num: 105, name: 'setuid',     args: 'rdi=uid',                       desc: "Modifie l'UID du processus. Utile en exploitation priv-esc." },
  { num: 231, name: 'exit_group', args: 'rdi=code',                      desc: "Termine tous les threads du groupe. C'est ce que _exit() appelle vraiment." },
]

// ─── SUB-REGISTERS ───────────────────────────────────────────────────────────

export const REG_MAIN = ['rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi', 'rsp', 'rbp', 'rip']
export const REG_EXT = ['r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15']

export interface SubReg {
  name: string
  bits: string
  val: number
}

export function getSubRegs(name: string, val64: number): SubReg[] {
  const v = BigInt.asUintN(64, BigInt(val64))
  const lo32 = Number(v & 0xffffffffn)
  const lo16 = Number(v & 0xffffn)
  const lo8  = Number(v & 0xffn)
  const hi8  = Number((v >> 8n) & 0xffn)
  if (name === 'rip') return []
  if (/^r\d+$/.test(name)) return [
    { name: name + 'd', bits: '31:0', val: lo32 },
    { name: name + 'w', bits: '15:0', val: lo16 },
    { name: name + 'b', bits: '7:0',  val: lo8 },
  ]
  const e32: Record<string, string> = { rax: 'eax', rbx: 'ebx', rcx: 'ecx', rdx: 'edx', rsi: 'esi', rdi: 'edi', rsp: 'esp', rbp: 'ebp' }
  const e16: Record<string, string> = { rax: 'ax', rbx: 'bx', rcx: 'cx', rdx: 'dx', rsi: 'si', rdi: 'di', rsp: 'sp', rbp: 'bp' }
  const e8l: Record<string, string> = { rax: 'al', rbx: 'bl', rcx: 'cl', rdx: 'dl', rsi: 'sil', rdi: 'dil', rsp: 'spl', rbp: 'bpl' }
  const e8h: Record<string, string> = { rax: 'ah', rbx: 'bh', rcx: 'ch', rdx: 'dh' }
  const subs: SubReg[] = [
    { name: e32[name], bits: '31:0', val: lo32 },
    { name: e16[name], bits: '15:0', val: lo16 },
  ]
  if (e8h[name]) subs.push({ name: e8h[name], bits: '15:8', val: hi8 })
  subs.push({ name: e8l[name], bits: '7:0', val: lo8 })
  return subs
}

export function toHex16(n: number): string {
  return '0x' + BigInt.asUintN(64, BigInt(n)).toString(16).padStart(16, '0')
}
