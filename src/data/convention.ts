export const CALLING_CONVENTION = {
  title: 'Convention d\'appel SysV AMD64 (Linux)',
  args: [
    { reg: 'rdi', role: '1er argument' },
    { reg: 'rsi', role: '2ème argument' },
    { reg: 'rdx', role: '3ème argument' },
    { reg: 'rcx', role: '4ème argument' },
    { reg: 'r8',  role: '5ème argument' },
    { reg: 'r9',  role: '6ème argument' },
  ],
  ret: { reg: 'rax', role: 'Valeur de retour (+ rdx si 128 bits)' },
  callerSaved: ['rax', 'rcx', 'rdx', 'rsi', 'rdi', 'r8', 'r9', 'r10', 'r11'],
  calleeSaved: ['rbx', 'rbp', 'r12', 'r13', 'r14', 'r15'],
  syscallArgs: [
    { reg: 'rax', role: 'Numéro du syscall' },
    { reg: 'rdi', role: '1er argument' },
    { reg: 'rsi', role: '2ème argument' },
    { reg: 'rdx', role: '3ème argument' },
    { reg: 'r10', role: '4ème argument' },
    { reg: 'r8',  role: '5ème argument' },
    { reg: 'r9',  role: '6ème argument' },
  ],
  notes: [
    'Les arguments au-delà du 6ème passent par la stack (push en ordre inverse).',
    'CALL pousse l\'adresse de retour (8 octets) → RSP doit être aligné à 16 avant CALL.',
    'Les registres caller-saved peuvent être écrasés par la fonction appelée.',
    'Les registres callee-saved doivent être restaurés avant RET.',
  ],
}
