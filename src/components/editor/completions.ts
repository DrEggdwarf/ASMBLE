import { LEXICON_INSTRS } from '../../data'
import { REGISTERS } from './tokenizer'

export interface CompletionItem {
  label: string
  kind: 'instruction' | 'register' | 'directive' | 'snippet' | 'section'
  detail: string
  insert: string
}

const ALL_COMPLETIONS: CompletionItem[] = [
  ...LEXICON_INSTRS.map(i => {
    const names = i.name.toLowerCase().includes('/') ? i.name.toLowerCase().split('/') : [i.name.toLowerCase()]
    return names.map(n => ({ label: n, kind: 'instruction' as const, detail: i.desc, insert: n }))
  }).flat(),
  ...Array.from(REGISTERS).map(r => ({ label: r, kind: 'register' as const, detail: `Register ${r.toUpperCase()}`, insert: r })),
  ...['section .text', 'section .data', 'section .bss', 'section .rodata'].map(s => ({ label: s, kind: 'section' as const, detail: 'Section declaration', insert: s })),
  ...['global', 'extern', 'bits 64', 'default rel'].map(d => ({ label: d, kind: 'directive' as const, detail: 'Directive', insert: d })),
  ...[
    { label: 'mov dst, src', insert: 'mov ', detail: 'Move data' },
    { label: 'syscall (exit)', insert: 'mov rax, 60\n    mov rdi, 0\n    syscall', detail: 'Linux exit(0) syscall' },
    { label: 'syscall (write)', insert: 'mov rax, 1\n    mov rdi, 1\n    mov rsi, msg\n    mov rdx, len\n    syscall', detail: 'Linux write(stdout, msg, len)' },
    { label: 'function prologue', insert: 'push rbp\n    mov rbp, rsp\n    sub rsp, 16', detail: 'Standard function prologue' },
    { label: 'function epilogue', insert: 'leave\n    ret', detail: 'Standard function epilogue' },
  ].map(s => ({ ...s, kind: 'snippet' as const })),
]

const _seen = new Set<string>()
export const COMPLETIONS = ALL_COMPLETIONS.filter(c => { const k = c.label + c.kind; if (_seen.has(k)) return false; _seen.add(k); return true })

// Instruction info map for tooltips
export const INSTR_INFO = new Map<string, { syntax: string; desc: string; cat: string }>()
LEXICON_INSTRS.forEach(i => {
  const names = i.name.toLowerCase().includes('/') ? i.name.toLowerCase().split('/') : [i.name.toLowerCase()]
  names.forEach(n => INSTR_INFO.set(n, { syntax: i.syntax, desc: i.desc, cat: i.cat }))
})

const KIND_LABELS: Record<string, string> = {
  instruction: 'i',
  register: 'r',
  directive: 'd',
  snippet: 's',
  section: 'S',
}

export function kindIcon(kind: string) {
  return KIND_LABELS[kind] || '-'
}

export function kindClass(kind: string) { return `asm-ac-kind-${kind}` }
