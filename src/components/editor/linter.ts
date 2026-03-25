import { tokenizeLine, INSTRUCTIONS, REGISTERS } from './tokenizer'

export interface LintError {
  line: number
  col: number
  len: number
  msg: string
  severity: 'error' | 'warning'
}

const DIRECTIVES = new Set([
  'section','segment','global','extern','default','bits','org','align',
  'use16','use32','use64','cpu','float',
  '%define','%undef','%ifdef','%ifndef','%if','%elif','%else','%endif',
  '%macro','%endmacro','%include','%assign','%rep','%endrep','%strlen','%substr',
])

const SECTION_NAMES = new Set(['.text','.data','.bss','.rodata','.note'])

const OPERAND_COUNTS: Record<string, [number, number]> = {
  mov: [2, 2], add: [2, 2], sub: [2, 2], imul: [1, 3], and: [2, 2], or: [2, 2], xor: [2, 2],
  cmp: [2, 2], test: [2, 2], lea: [2, 2], movzx: [2, 2], movsx: [2, 2], xchg: [2, 2],
  shl: [2, 2], shr: [2, 2], sar: [2, 2], rol: [2, 2], ror: [2, 2],
  push: [1, 1], pop: [1, 1], inc: [1, 1], dec: [1, 1], neg: [1, 1], not: [1, 1],
  mul: [1, 1], div: [1, 1], idiv: [1, 1],
  ret: [0, 1], syscall: [0, 0], nop: [0, 0], hlt: [0, 0], leave: [0, 0],
  cqo: [0, 0], cdq: [0, 0], cbw: [0, 0], cwde: [0, 0], cdqe: [0, 0], cwd: [0, 0],
  jmp: [1, 1], je: [1, 1], jz: [1, 1], jne: [1, 1], jnz: [1, 1],
  jl: [1, 1], jle: [1, 1], jg: [1, 1], jge: [1, 1], jb: [1, 1], ja: [1, 1],
  jnge: [1, 1], jng: [1, 1], jnle: [1, 1], jnl: [1, 1], jnae: [1, 1], jnbe: [1, 1],
  js: [1, 1], jo: [1, 1], loop: [1, 1], call: [1, 1],
  int: [1, 1], enter: [2, 2], cpuid: [0, 0],
}

const DATA_DECL = new Set([
  'db','dw','dd','dq','dt','do','dy',
  'resb','resw','resd','resq','rest','reso','resy',
  'times','equ','incbin',
])

const SIZES = new Set(['byte','word','dword','qword','tword','oword','yword','ptr'])

export function lintCode(lines: string[]): LintError[] {
  const errors: LintError[] = []
  const labelDefs = new Set<string>()
  const labelRefs: { name: string; line: number; col: number }[] = []

  // Collect label definitions (colon-style AND NASM-style without colon)
  lines.forEach(line => {
    const m = line.match(/^[ \t]*([a-zA-Z_.@$][a-zA-Z0-9_.@$]*):/)
    if (m) labelDefs.add(m[1].toLowerCase())
    // NASM: "msg db ...", "len equ ...", "buf resb 64"
    const nasm = line.match(/^[ \t]*([a-zA-Z_.@$][a-zA-Z0-9_.@$]*)\s+(db|dw|dd|dq|dt|resb|resw|resd|resq|equ|times)\b/i)
    if (nasm) labelDefs.add(nasm[1].toLowerCase())
  })

  lines.forEach((line, lineIdx) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(';')) return

    let content = trimmed
    const labelMatch = content.match(/^([a-zA-Z_.@$][a-zA-Z0-9_.@$]*):(.*)/)
    if (labelMatch) content = labelMatch[2].trim()
    if (!content || content.startsWith(';')) return

    const firstWord = content.split(/[\s,]+/)[0].toLowerCase()
    if (DIRECTIVES.has(firstWord) || SECTION_NAMES.has(firstWord) || firstWord.startsWith('%')) return
    if (DATA_DECL.has(firstWord)) return

    // NASM-style: identifier followed by data pseudo-op ("msg db ...", "len equ ...")
    const words = content.split(/\s+/)
    if (words.length >= 2 && DATA_DECL.has(words[1].toLowerCase())) return

    const tokens = tokenizeLine(content)
    const nonSpace = tokens.filter(t => t.type !== 'plain' || t.text.trim())
    if (nonSpace.length === 0) return

    const instrToken = nonSpace[0]
    const instrName = instrToken.text.toLowerCase()

    if (SIZES.has(instrName)) return

    if (!INSTRUCTIONS.has(instrName)) {
      const col = line.indexOf(instrToken.text)
      if (instrToken.type === 'plain' && !labelDefs.has(instrName)) {
        errors.push({ line: lineIdx, col, len: instrToken.text.length, msg: `Unknown instruction: '${instrToken.text}'`, severity: 'error' })
      }
      return
    }

    // Count operands
    const afterInstr = content.slice(content.indexOf(instrToken.text) + instrToken.text.length)
    const beforeComment = afterInstr.split(';')[0].trim()
    if (beforeComment) {
      let depth = 0, opCount = 1
      for (const ch of beforeComment) {
        if (ch === '[') depth++
        else if (ch === ']') depth--
        else if (ch === ',' && depth === 0) opCount++
      }
      const expected = OPERAND_COUNTS[instrName]
      if (expected) {
        if (opCount < expected[0]) {
          errors.push({ line: lineIdx, col: line.indexOf(instrToken.text), len: instrToken.text.length, msg: `'${instrName}' expects at least ${expected[0]} operand(s), got ${opCount}`, severity: 'error' })
        } else if (opCount > expected[1]) {
          errors.push({ line: lineIdx, col: line.indexOf(instrToken.text), len: instrToken.text.length, msg: `'${instrName}' expects at most ${expected[1]} operand(s), got ${opCount}`, severity: 'error' })
        }
      }
    } else {
      const expected = OPERAND_COUNTS[instrName]
      if (expected && expected[0] > 0) {
        errors.push({ line: lineIdx, col: line.indexOf(instrToken.text), len: instrToken.text.length, msg: `'${instrName}' expects at least ${expected[0]} operand(s)`, severity: 'error' })
      }
    }

    // Check label references in jumps/calls
    const jumpMatch = content.match(/^(jmp|je|jz|jne|jnz|jl|jle|jg|jge|jb|ja|jnge|jng|jnle|jnl|jnae|jnbe|js|jo|loop|call)\s+([a-zA-Z_.@$][a-zA-Z0-9_.@$]*)/i)
    if (jumpMatch) {
      const lbl = jumpMatch[2]
      if (!labelDefs.has(lbl.toLowerCase()) && !REGISTERS.has(lbl.toLowerCase())) {
        const col = line.indexOf(lbl, line.indexOf(jumpMatch[1]) + jumpMatch[1].length)
        labelRefs.push({ name: lbl, line: lineIdx, col: col >= 0 ? col : 0 })
      }
    }

    // Bracket balance
    let bracketDepth = 0
    for (let c = 0; c < content.length; c++) {
      if (content[c] === '[') bracketDepth++
      else if (content[c] === ']') bracketDepth--
      if (bracketDepth < 0) {
        errors.push({ line: lineIdx, col: line.indexOf(']', c), len: 1, msg: 'Unmatched closing bracket', severity: 'error' })
        break
      }
    }
    if (bracketDepth > 0) {
      errors.push({ line: lineIdx, col: line.lastIndexOf('['), len: 1, msg: 'Unmatched opening bracket', severity: 'error' })
    }
  })

  labelRefs.forEach(ref => {
    errors.push({ line: ref.line, col: ref.col, len: ref.name.length, msg: `Undefined label: '${ref.name}'`, severity: 'warning' })
  })

  return errors
}
