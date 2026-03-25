export const MEMORY_SECTIONS = [
  {
    name: '.text',
    start: 0x401000,
    desc: 'Code exécutable',
    entries: [
      { addr: 0x401000, label: 'double:', bytes: '55', instr: 'push rbp' },
      { addr: 0x401001, label: '', bytes: '48 89 e5', instr: 'mov rbp, rsp' },
      { addr: 0x401004, label: '', bytes: '48 83 ec 10', instr: 'sub rsp, 16' },
      { addr: 0x401008, label: '', bytes: '48 89 7d f8', instr: 'mov [rbp-8], rdi' },
      { addr: 0x40100c, label: '', bytes: '48 8b 45 f8', instr: 'mov rax, [rbp-8]' },
      { addr: 0x401010, label: '', bytes: '48 d1 e0', instr: 'shl rax, 1' },
      { addr: 0x401013, label: '', bytes: 'c9', instr: 'leave' },
      { addr: 0x401014, label: '', bytes: 'c3', instr: 'ret' },
      { addr: 0x401030, label: '_start:', bytes: '48 c7 c7 15 00 00 00', instr: 'mov rdi, 21' },
      { addr: 0x401037, label: '', bytes: 'e8 c4 ff ff ff', instr: 'call double' },
      { addr: 0x40103c, label: '', bytes: '48 89 c3', instr: 'mov rbx, rax' },
      { addr: 0x40103f, label: '', bytes: '48 89 df', instr: 'mov rdi, rbx' },
      { addr: 0x401042, label: '', bytes: '48 c7 c0 3c 00 00 00', instr: 'mov rax, 60' },
      { addr: 0x401049, label: '', bytes: '0f 05', instr: 'syscall' },
    ],
  },
]
