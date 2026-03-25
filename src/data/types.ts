// ─── Types ───────────────────────────────────────────────────────────────────

export interface CodeLine {
  line: number
  label: string
  indent: number
  type: 'section' | 'directive' | 'label' | 'instr' | 'empty'
}

export interface DisasmEntry {
  addr: number
  bytes?: string
  instr: string
  label?: string
}

export interface FrameInfo {
  level: number
  addr: number
  func: string
  file: string
  line: number
}

export interface SectionInfo {
  name: string
  start: number
  end: number
  size: number
}

export interface StepSnapshot {
  ip: number
  instr: string | null
  regs: Record<string, number>
  flags: Record<string, number | boolean>
  changed: string[]
  stackEntries: { addr: number; val: number; label?: string; isRsp?: boolean; isRbp?: boolean }[]
  annotation: string
  jumped?: boolean
  flagHint?: string
  memory?: { addr: number; label: string; val: number | string }[]
  disassembly?: DisasmEntry[]
  backtrace?: FrameInfo[]
  sections?: SectionInfo[]
  inferiorOutput?: string[]
}

export interface CPattern {
  category: string
  label: string
  c: string
  asm: string
  note?: string
}

export interface LexiconInstr {
  cat: string
  name: string
  syntax: string
  desc: string
}

export interface Syscall {
  num: number
  name: string
  args: string
  desc: string
}

export interface SubReg {
  name: string
  bits: string
  val: number
}

export interface ChecksecResult {
  relro: string
  canary: boolean
  nx: boolean
  pie: boolean
  rpath: boolean
  runpath: boolean
  fortify: boolean
  stripped: boolean
}

export interface VmmapEntry {
  start: string
  end: string
  size: string
  perms: string
  path: string
}

export interface GotEntry {
  name: string
  addr: string
  type: string
  value: string
}
