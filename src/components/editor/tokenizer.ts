import { LEXICON_INSTRS } from '../../data'

// ─── Token types ─────────────────────────────────────────────────────────────

export type TokenType = 'comment' | 'keyword' | 'register' | 'number' | 'string' | 'label-def' | 'label-ref' | 'directive' | 'section' | 'prefix' | 'punctuation' | 'plain'

export interface Token { type: TokenType; text: string; col: number }

const INSTRUCTIONS = new Set(LEXICON_INSTRS.map(i => {
  const n = i.name.toLowerCase()
  return n.includes('/') ? n.split('/') : [n]
}).flat())

;['mov','movzx','movsx','lea','push','pop','xchg','add','sub','inc','dec','imul','mul','idiv','div','neg','cqo','cdq',
  'and','or','xor','not','test','shl','shr','sar','rol','ror','cmp','jmp','je','jz','jne','jnz','jl','jnge','jle','jng',
  'jg','jnle','jge','jnl','jb','jnae','ja','jnbe','js','jo','loop','call','ret','leave','enter','syscall','nop','hlt','int','cpuid',
  'cmove','cmovne','cmovz','cmovnz','cmovl','cmovle','cmovg','cmovge','cmova','cmovae','cmovb','cmovbe',
  'sete','setne','setl','setle','setg','setge','seta','setae','setb','setbe',
  'rep','repe','repne','repz','repnz','movsb','movsw','movsd','movsq','stosb','stosw','stosd','stosq',
  'lodsb','lodsw','lodsd','lodsq','scasb','scasw','scasd','scasq','cmpsb','cmpsw','cmpsd','cmpsq',
  'cbw','cwde','cdqe','cwd','bswap','bt','bts','btr','btc','bsf','bsr',
  'lock','xadd','cmpxchg','rdtsc','rdtscp','lfence','sfence','mfence',
  'movaps','movups','movdqa','movdqu','addps','addpd','mulps','mulpd','subps','subpd','divps','divpd',
  'movss','movsd','addss','addsd','mulss','mulsd','subss','subsd','divss','divsd',
  'pxor','por','pand','pandn','paddq','psubq',
  'db','dw','dd','dq','resb','resw','resd','resq','times','equ',
].forEach(i => INSTRUCTIONS.add(i))

export { INSTRUCTIONS }

export const REGISTERS = new Set([
  'rax','rbx','rcx','rdx','rsi','rdi','rsp','rbp','rip',
  'eax','ebx','ecx','edx','esi','edi','esp','ebp','eip',
  'ax','bx','cx','dx','si','di','sp','bp',
  'al','bl','cl','dl','sil','dil','spl','bpl','ah','bh','ch','dh',
  'r8','r9','r10','r11','r12','r13','r14','r15',
  'r8d','r9d','r10d','r11d','r12d','r13d','r14d','r15d',
  'r8w','r9w','r10w','r11w','r12w','r13w','r14w','r15w',
  'r8b','r9b','r10b','r11b','r12b','r13b','r14b','r15b',
  'xmm0','xmm1','xmm2','xmm3','xmm4','xmm5','xmm6','xmm7',
  'xmm8','xmm9','xmm10','xmm11','xmm12','xmm13','xmm14','xmm15',
  'ymm0','ymm1','ymm2','ymm3','ymm4','ymm5','ymm6','ymm7',
  'cs','ds','es','fs','gs','ss',
])

const DIRECTIVES = new Set([
  'section','segment','global','extern','default','bits','org','align',
  'use16','use32','use64','cpu','float',
  '%define','%undef','%ifdef','%ifndef','%if','%elif','%else','%endif',
  '%macro','%endmacro','%include','%assign','%rep','%endrep','%strlen','%substr',
])

const SIZES = new Set(['byte','word','dword','qword','tword','oword','yword','ptr'])
const SECTION_NAMES = new Set(['.text','.data','.bss','.rodata','.note'])

export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < line.length) {
    if (/\s/.test(line[i])) {
      const start = i
      while (i < line.length && /\s/.test(line[i])) i++
      tokens.push({ type: 'plain', text: line.slice(start, i), col: start })
      continue
    }
    if (line[i] === ';') {
      tokens.push({ type: 'comment', text: line.slice(i), col: i })
      break
    }
    if (line[i] === '"' || line[i] === "'") {
      const q = line[i]
      let j = i + 1
      while (j < line.length && line[j] !== q) { if (line[j] === '\\') j++; j++ }
      if (j < line.length) j++
      tokens.push({ type: 'string', text: line.slice(i, j), col: i })
      i = j
      continue
    }
    if (/[0-9]/.test(line[i]) || (line[i] === '0' && i + 1 < line.length && /[xXbBoO]/.test(line[i + 1]))) {
      let j = i
      if (line[j] === '0' && j + 1 < line.length && /[xX]/.test(line[j + 1])) {
        j += 2; while (j < line.length && /[0-9a-fA-F_]/.test(line[j])) j++
      } else if (line[j] === '0' && j + 1 < line.length && /[bB]/.test(line[j + 1])) {
        j += 2; while (j < line.length && /[01_]/.test(line[j])) j++
      } else {
        while (j < line.length && /[0-9_]/.test(line[j])) j++
        if (j < line.length && /[hH]/.test(line[j])) j++
      }
      tokens.push({ type: 'number', text: line.slice(i, j), col: i })
      i = j
      continue
    }
    if (/[[\],+\-*:]/.test(line[i])) {
      tokens.push({ type: 'punctuation', text: line[i], col: i })
      i++
      continue
    }
    if (line[i] === '%') {
      let j = i + 1
      while (j < line.length && /[a-zA-Z_]/.test(line[j])) j++
      const word = line.slice(i, j).toLowerCase()
      if (DIRECTIVES.has(word)) {
        tokens.push({ type: 'directive', text: line.slice(i, j), col: i })
        i = j
        continue
      }
    }
    if (/[a-zA-Z_.@$]/.test(line[i])) {
      let j = i
      while (j < line.length && /[a-zA-Z0-9_.@$]/.test(line[j])) j++
      const word = line.slice(i, j)
      const lower = word.toLowerCase()
      if (j < line.length && line[j] === ':') {
        tokens.push({ type: 'label-def', text: word, col: i })
        i = j
        continue
      }
      if (DIRECTIVES.has(lower)) tokens.push({ type: 'directive', text: word, col: i })
      else if (SECTION_NAMES.has(lower)) tokens.push({ type: 'section', text: word, col: i })
      else if (SIZES.has(lower)) tokens.push({ type: 'prefix', text: word, col: i })
      else if (REGISTERS.has(lower)) tokens.push({ type: 'register', text: word, col: i })
      else if (INSTRUCTIONS.has(lower)) tokens.push({ type: 'keyword', text: word, col: i })
      else {
        const prevNonSpace = tokens.filter(t => t.type !== 'plain').slice(-1)[0]
        if (prevNonSpace && /^(jmp|je|jz|jne|jnz|jl|jle|jg|jge|jb|ja|jnge|jng|jnle|jnl|jnae|jnbe|js|jo|loop|call)$/i.test(prevNonSpace.text))
          tokens.push({ type: 'label-ref', text: word, col: i })
        else
          tokens.push({ type: 'plain', text: word, col: i })
      }
      i = j
      continue
    }
    tokens.push({ type: 'plain', text: line[i], col: i })
    i++
  }
  return tokens
}
