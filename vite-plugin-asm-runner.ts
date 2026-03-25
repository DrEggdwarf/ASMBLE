import type { Plugin } from 'vite'
import { execFile } from 'child_process'
import { writeFile, rm, mkdtemp } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

/** Run a command, capture stdout/stderr, return exit code. */
function run(cmd: string, args: string[], timeout = 10_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, stdout, stderr })
      const code = typeof (err as NodeJS.ErrnoException).code === 'number'
        ? (err as NodeJS.ErrnoException).code as unknown as number
        : err.killed ? 137 : 1
      resolve({ code, stdout, stderr })
    })
  })
}

/** Assemble + link. Returns { binFile, dir } on success or { error, output } on failure. */
async function assemble(code: string, flavor: string) {
  const allowedFlavors = ['nasm', 'gas', 'fasm', 'yasm']
  const safeFlavor = allowedFlavors.includes(flavor) ? flavor : 'nasm'

  const dir = await mkdtemp(join(tmpdir(), 'asmble-'))
  const srcFile = join(dir, 'source.asm')
  const objFile = join(dir, 'source.o')
  const binFile = join(dir, 'source')
  const output: string[] = []

  await writeFile(srcFile, code)

  // Assemble
  let asmCmd: string, asmArgs: string[]
  if (safeFlavor === 'gas') {
    asmCmd = 'as'; asmArgs = ['--64', '-g', '-o', objFile, srcFile]
  } else {
    asmCmd = safeFlavor; asmArgs = ['-f', 'elf64', '-g', '-F', 'dwarf', srcFile, '-o', objFile]
  }
  const asm = await run(asmCmd, asmArgs)
  if (asm.stderr.trim()) output.push(asm.stderr.trim().replaceAll(dir + '/', ''))
  if (asm.code !== 0) return { error: true, output: [...output, `[error] Assembly failed (exit ${asm.code})`], dir }

  // Link
  const link = await run('ld', ['-m', 'elf_x86_64', objFile, '-o', binFile])
  if (link.stderr.trim()) output.push(link.stderr.trim().replaceAll(dir + '/', ''))
  if (link.code !== 0) return { error: true, output: [...output, `[error] Linking failed (exit ${link.code})`], dir }

  return { error: false, binFile, srcFile, dir, output }
}

/** Read JSON body from request */
async function readBody(req: import('http').IncomingMessage): Promise<{ code: string; flavor?: string } | null> {
  let body = ''
  for await (const chunk of req) body += chunk
  try { return JSON.parse(body) } catch { return null }
}

const GP_REGS = ['rax','rbx','rcx','rdx','rsi','rdi','rsp','rbp','rip','r8','r9','r10','r11','r12','r13','r14','r15']
const FLAG_NAMES = ['CF','PF','AF','ZF','SF','OF','DF']

interface TraceStep {
  ip: number
  instr: string | null
  regs: Record<string, number>
  flags: Record<string, number>
  changed: string[]
  stackEntries: { addr: number; val: number; label?: string }[]
  annotation: string
  jumped?: boolean
  programOutput?: string
}

/** Parse GDB batch output into trace steps */
function parseGdbTrace(raw: string, sourceCode: string): { steps: TraceStep[]; programOutput: string[] } {
  const sourceLines = sourceCode.split('\n')
  const steps: TraceStep[] = []
  const programOutput: string[] = []

  // Split on our markers
  const blocks = raw.split('===STEP===')
  let prevRegs: Record<string, number> | null = null
  let prevIp = 0

  for (const block of blocks) {
    if (!block.includes('===REGS===')) continue

    const regsSection = block.split('===REGS===')[1]?.split('===ENDREGS===')[0] ?? ''
    const flagsSection = block.split('===FLAGS===')[1]?.split('===ENDFLAGS===')[0] ?? ''
    const lineSection = block.split('===LINE===')[1]?.split('===ENDLINE===')[0] ?? ''
    const stackSection = block.split('===STACK===')[1]?.split('===ENDSTACK===')[0] ?? ''
    const outputSection = block.split('===OUTPUT===')[1]?.split('===ENDOUTPUT===')[0] ?? ''

    // Parse registers
    const regs: Record<string, number> = {}
    for (const line of regsSection.split('\n')) {
      const m = line.match(/^(\w+)\s+(0x[\da-f]+)/i)
      if (m && GP_REGS.includes(m[1].toLowerCase())) {
        regs[m[1].toLowerCase()] = parseInt(m[2], 16)
      }
    }
    if (Object.keys(regs).length === 0) continue

    // Parse flags from eflags text like "[ CF ZF IF ]"
    const flags: Record<string, number> = { ZF: 0, CF: 0, SF: 0, OF: 0, PF: 0, AF: 0, DF: 0 }
    const flagMatch = flagsSection.match(/\[([^\]]*)\]/)
    if (flagMatch) {
      const activeFlags = flagMatch[1].trim().split(/\s+/)
      for (const f of FLAG_NAMES) {
        flags[f] = activeFlags.includes(f) ? 1 : 0
      }
    }

    // Parse source line number from "Line N of"
    let lineNum = 1
    const lineMatch = lineSection.match(/Line\s+(\d+)\s+of/)
    if (lineMatch) lineNum = parseInt(lineMatch[1])

    // Get instruction text from source
    const instrText = lineNum > 0 && lineNum <= sourceLines.length
      ? sourceLines[lineNum - 1].replace(/;.*$/, '').trim().replace(/^\.?\w+:\s*/, '') || null
      : null

    // Parse stack: "0xADDR: 0xVALUE"
    const stackEntries: { addr: number; val: number; label?: string }[] = []
    for (const line of stackSection.split('\n')) {
      const m = line.match(/(0x[\da-f]+):\s+(0x[\da-f]+)/i)
      if (m) {
        stackEntries.push({ addr: parseInt(m[1], 16), val: parseInt(m[2], 16) })
      }
    }
    // Label stack entries
    const rsp = regs.rsp ?? 0
    const rbp = regs.rbp ?? 0
    for (const e of stackEntries) {
      if (e.addr === rsp) e.label = '← RSP'
      else if (e.addr === rbp && rbp !== rsp) e.label = '← RBP'
    }

    // Capture program output (from inferior's stdout captured by GDB)
    if (outputSection.trim()) {
      programOutput.push(outputSection.trim())
    }

    // Detect changed registers
    const changed = prevRegs ? GP_REGS.filter(r => regs[r] !== prevRegs[r]) : []

    steps.push({
      ip: lineNum,
      instr: instrText,
      regs: { ...regs },
      flags: { ...flags },
      changed,
      stackEntries: stackEntries.length > 0 ? stackEntries : [{ addr: rsp, val: 0, label: '← RSP' }],
      annotation: instrText || `line ${lineNum}`,
      jumped: false,
    })

    prevRegs = { ...regs }
    prevIp = lineNum
  }

  // Post-process: set jumped on the SOURCE step (the j*/call/loop/ret instruction),
  // detected by checking if the NEXT step's ip is non-sequential
  const JUMP_RE = /^\s*(jmp|je|jz|jne|jnz|jl|jle|jg|jge|jb|jbe|ja|jae|jnge|jng|jnle|jnl|jnae|jnbe|jnb|jnc|jc|js|jns|jo|jno|loop|loope|loopne|call|ret)\b/i
  for (let i = 0; i < steps.length - 1; i++) {
    const curIp = steps[i].ip
    const nextIp = steps[i + 1].ip
    const isJumpInstr = steps[i].instr && JUMP_RE.test(steps[i].instr!)
    if (isJumpInstr && nextIp !== curIp + 1) {
      steps[i].jumped = true
      steps[i].annotation += ` → saut vers ligne ${nextIp}`
    }
  }

  return { steps, programOutput }
}

export function asmRunnerPlugin(): Plugin {
  return {
    name: 'asm-runner',
    configureServer(server) {

      // ── /api/run — Build & execute, return output ──
      server.middlewares.use('/api/run', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('{}'); return }
        const parsed = await readBody(req)
        if (!parsed?.code) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Missing code' })); return }

        const result = await assemble(parsed.code, parsed.flavor ?? 'nasm')
        if (result.error || !('binFile' in result)) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ output: result.output, success: false }))
          rm(result.dir, { recursive: true, force: true }).catch(() => {})
          return
        }

        const exec = await run(result.binFile, [], 5_000)
        const output = [...result.output]
        if (exec.stdout) output.push(exec.stdout.replace(/\n$/, ''))
        if (exec.stderr) output.push(exec.stderr.replace(/\n$/, ''))
        output.push(exec.code === 137 ? '[error] Process killed (timeout 5s)' : `Process exited with code ${exec.code}`)

        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ output, success: true, exitCode: exec.code }))
        rm(result.dir, { recursive: true, force: true }).catch(() => {})
      })

      // ── /api/trace — Build & GDB step-by-step trace ──
      server.middlewares.use('/api/trace', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('{}'); return }
        const parsed = await readBody(req)
        if (!parsed?.code) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Missing code' })); return }

        const result = await assemble(parsed.code, parsed.flavor ?? 'nasm')
        if (result.error || !('binFile' in result)) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ output: result.output, success: false, steps: [] }))
          rm(result.dir, { recursive: true, force: true }).catch(() => {})
          return
        }

        // Build GDB script: break at _start, run, then stepi in a loop with register/flag/stack dumps
        const maxSteps = 500
        const gdbScript = [
          'set pagination off',
          'set confirm off',
          'break _start',
          'run',
        ]
        for (let i = 0; i < maxSteps; i++) {
          gdbScript.push(
            'echo ===STEP===\\n',
            'echo ===REGS===\\n',
            'info registers rax rbx rcx rdx rsi rdi rsp rbp rip r8 r9 r10 r11 r12 r13 r14 r15',
            'echo ===ENDREGS===\\n',
            'echo ===FLAGS===\\n',
            'info registers eflags',
            'echo ===ENDFLAGS===\\n',
            'echo ===LINE===\\n',
            'info line *$rip',
            'echo ===ENDLINE===\\n',
            'echo ===STACK===\\n',
            'x/8xg $rsp',
            'echo ===ENDSTACK===\\n',
            'echo ===OUTPUT===\\n',
            'echo ===ENDOUTPUT===\\n',
            'stepi',
          )
        }
        gdbScript.push('quit')

        const scriptFile = join(result.dir, 'trace.gdb')
        await writeFile(scriptFile, gdbScript.join('\n'))

        const gdb = await run('gdb', ['-nx', '-batch', '-q', '-x', scriptFile, result.binFile], 30_000)

        const { steps, programOutput } = parseGdbTrace(gdb.stdout, parsed.code)

        // Also run the binary for actual program output
        const exec = await run(result.binFile, [], 5_000)
        const runOutput: string[] = []
        if (exec.stdout) runOutput.push(exec.stdout.replace(/\n$/, ''))
        if (exec.stderr) runOutput.push(exec.stderr.replace(/\n$/, ''))
        runOutput.push(exec.code === 137 ? '[error] Process killed (timeout 5s)' : `Process exited with code ${exec.code}`)

        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({
          success: true,
          steps,
          output: [...result.output, ...runOutput],
          programOutput,
        }))
        rm(result.dir, { recursive: true, force: true }).catch(() => {})
      })
    },
  }
}
