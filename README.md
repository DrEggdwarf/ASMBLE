# ASMBLE

Interactive pedagogical x86-64 assembly debugger. Browser-based, self-hosted.

## Features

- Step-by-step execution of x86-64 NASM assembly
- Live register view with sub-register expansion
- Flags panel (ZF, CF, SF, OF)
- Stack visualisation with RSP/RBP pointers
- Execution history with register deltas
- C to ASM reference patterns
- Searchable instruction lexicon and Linux syscall reference

## Files

- App.tsx - Main debugger UI component
- data.ts - Execution steps, patterns, lexicon, syscalls
- index.ts - Module entry point (mount/unmount)
- asmble.css - Dark-themed styles
- manifest.json - App metadata

## Tech Stack

- React 18+ (TSX), Pure CSS, TypeScript

## License

MIT
