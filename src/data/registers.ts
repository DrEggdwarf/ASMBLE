import type { SubReg } from './types'

export const REG_MAIN = ['rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi', 'rsp', 'rbp', 'rip']
export const REG_EXT = ['r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15']

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
