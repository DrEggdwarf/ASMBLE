# ASMBLE — x86-64 Pedagogical Debugger

## Overview

Interactive step-by-step x86-64 assembly debugger for learning.
Paste a snippet, step through it, see registers/flags/stack change in real-time.
GitHub: https://github.com/DrEggdwarf/ASMBLE

## Current State

**Frontend (mock data)**: Complete
- Editor (editable textarea with line numbers + RIP indicator)
- Registers with clickable sub-registers (rax → eax/ax/ah/al)
- r8-r15 collapsible section
- Flags (ZF, CF, SF, OF) with active/inactive state
- Stack view with RSP/RBP markers
- Execution history with register deltas
- C→ASM patterns (17 patterns with notes)
- Lexicon: ~45 instructions + ~15 syscalls with full-text search

**Backend (TODO)**: Not started
- FastAPI + GDB/MI for real assembly/debugging
- Endpoints: /assemble, /run, /step/{id}, /step/{id}/back, /session/{id}
- nasm + ld for assembly, GDB for stepping

## Files

```
asmble/
├── manifest.json   # Lab app manifest (id, name, description, etc.)
├── App.tsx         # Main React component (all UI)
├── data.ts         # Mock data: sample code, step snapshots, C patterns, lexicon
├── asmble.css      # All styles, prefixed `asm-`
└── index.ts        # mount/unmount factory for lab integration (createRoot)
```

## Color Hierarchy

- Root: `#010409` (darkest)
- Panels/bars: `#0d1117`
- Cards/items: `#161b22`
- Changed registers: green `#3fb950`
- Active flags: red `#ff7b72`
- Jump badge: blue `#388bfd`

## Integration

Registered in `lab/registry.ts` as the first real app.
Group: "Security". Mode: desktop only.
