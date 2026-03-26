import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { LEXICON_INSTRS, SYSCALLS, REG_MAIN, REG_EXT, MEMORY_SECTIONS } from './data'
import type { StepSnapshot } from './data/types'
import AsmEditor from './components/editor/AsmEditor'
import { RegCard, RegExtRow } from './components/RegCard'
import { StackPanel } from './components/panels/StackPanel'
import { MemoryPanel } from './components/panels/MemoryPanel'
import { ConsolePanel } from './components/panels/ConsolePanel'
import { EvalPanel } from './components/panels/EvalPanel'
import { SecurityPanel } from './components/panels/SecurityPanel'
import { ReferenceModal } from './components/ReferenceModal'
import { CommandPalette } from './components/CommandPalette'
import { GuidedTour, shouldShowTour } from './components/GuidedTour'
import { useColResize } from './hooks/useColResize'
import { useTermResize } from './hooks/useTermResize'
import { useGdbSession } from './hooks/useGdbSession'
import './styles/index.css'

type Toast = { id: number; msg: string; kind: 'error' | 'info' | 'success' }
let toastId = 0

const IS_LIVE = import.meta.env.VITE_LIVE_MODE === 'true'

const MAIN_REGS = REG_MAIN.filter(r => r !== 'rip')

const SNIPPETS = [
  { name: 'Hello World', code: `section .data\n    msg db "Hello, World!", 10\n    len equ $ - msg\n\nsection .text\n    global _start\n\n_start:\n    mov rax, 1          ; sys_write\n    mov rdi, 1          ; stdout\n    mov rsi, msg        ; buffer\n    mov rdx, len        ; length\n    syscall\n\n    mov rax, 60         ; sys_exit\n    xor rdi, rdi        ; code 0\n    syscall` },
  { name: 'Boucle', code: `section .text\n    global _start\n\n_start:\n    mov rcx, 10         ; compteur\n\nloop_start:\n    dec rcx\n    jnz loop_start      ; boucle tant que rcx != 0\n\n    mov rax, 60\n    xor rdi, rdi\n    syscall` },
  { name: 'Fonction', code: `section .text\n    global _start\n\n_start:\n    mov rdi, 5\n    call factorial\n    ; résultat dans rax\n    mov rdi, rax\n    mov rax, 60\n    syscall\n\nfactorial:\n    push rbp\n    mov rbp, rsp\n    cmp rdi, 1\n    jle .base\n    push rdi\n    dec rdi\n    call factorial\n    pop rdi\n    imul rax, rdi\n    jmp .done\n.base:\n    mov rax, 1\n.done:\n    pop rbp\n    ret` },
  { name: 'Stack Frame', code: `section .text\n    global _start\n\n_start:\n    ; Stack frame\n    push rbp\n    mov rbp, rsp\n    sub rsp, 16         ; espace local\n\n    mov qword [rbp-8], 42\n    mov rax, [rbp-8]\n\n    leave\n    mov rax, 60\n    xor rdi, rdi\n    syscall` },
  { name: 'Conditions', code: `section .text\n    global _start\n\n_start:\n    mov rax, 10\n    cmp rax, 5\n    jg .greater\n    jmp .less\n\n.greater:\n    mov rbx, 1          ; rax > 5\n    jmp .done\n\n.less:\n    mov rbx, 0          ; rax <= 5\n\n.done:\n    mov rax, 60\n    mov rdi, rbx\n    syscall` },
  { name: 'Tableau', code: `section .data\n    arr dq 10, 20, 30, 40, 50\n    len equ ($ - arr) / 8\n\nsection .text\n    global _start\n\n_start:\n    xor rax, rax        ; somme = 0\n    xor rcx, rcx        ; index = 0\n\n.loop:\n    cmp rcx, len\n    jge .done\n    add rax, [arr + rcx*8]\n    inc rcx\n    jmp .loop\n\n.done:\n    mov rdi, rax\n    mov rax, 60\n    syscall` },
] as const

const HISTORY_KEY = 'asmble_history'
const HISTORY_MAX = 10
type HistoryEntry = { code: string; label: string; ts: number }

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') }
  catch { return [] }
}
function saveToHistory(code: string) {
  if (!code.trim()) return
  const history = loadHistory()
  const firstLine = code.split('\n').find(l => l.trim())?.trim().slice(0, 40) || 'untitled'
  const label = firstLine.replace(/^[;#]/, '').trim() || 'untitled'
  // Deduplicate exact matches
  const filtered = history.filter(h => h.code !== code)
  filtered.unshift({ code, label, ts: Date.now() })
  localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered.slice(0, HISTORY_MAX)))
}

const EMPTY_SNAP: StepSnapshot = {
  ip: 1, instr: null,
  regs: { rax: 0, rbx: 0, rcx: 0, rdx: 0, rsi: 0, rdi: 0, rsp: 0, rbp: 0, rip: 0, r8: 0, r9: 0, r10: 0, r11: 0, r12: 0, r13: 0, r14: 0, r15: 0 },
  flags: { ZF: 0, CF: 0, SF: 0, OF: 0, PF: 0, AF: 0, DF: 0 },
  changed: [], stackEntries: [], annotation: 'Paste code and click Build & Run to trace with GDB.',
}

/** Évalue une expression localement à partir du snapshot courant. */
function localEval(expr: string, snap: StepSnapshot): string {
  const e = expr.trim().toLowerCase()
  if (e === 'flags') return Object.entries(snap.flags).map(([f, v]) => `${f}=${v ? 1 : 0}`).join(' ')
  if (e === 'regs') return Object.entries(snap.regs).map(([r, v]) => `${r}=0x${v.toString(16)}`).join('  ')
  if (e === 'stack') {
    if (snap.stackEntries.length === 0) return '(stack vide)'
    return snap.stackEntries.slice(0, 8).map(s =>
      `0x${s.addr.toString(16)}: 0x${s.val.toString(16)}${s.label ? ' ' + s.label : ''}`
    ).join('\n')
  }
  const fmtMatch = e.match(/^(hex|dec|bin)\((.+)\)$/)
  if (fmtMatch) {
    const fmt = fmtMatch[1]
    const inner = localEval(fmtMatch[2], snap)
    const num = parseInt(inner, inner.startsWith('0x') ? 16 : 10)
    if (isNaN(num)) return `? (${inner})`
    if (fmt === 'hex') return '0x' + BigInt.asUintN(64, BigInt(num)).toString(16)
    if (fmt === 'bin') return '0b' + BigInt.asUintN(64, BigInt(num)).toString(2)
    return String(num)
  }
  const resolveReg = (token: string): number | null => {
    const name = token.replace(/^\$/, '').toLowerCase()
    if (name in snap.regs) return snap.regs[name]
    return null
  }
  const arithMatch = e.match(/^([^\+\-\*]+)([\+\-\*])(.+)$/)
  if (arithMatch) {
    const lVal = evalAtom(arithMatch[1].trim(), resolveReg)
    const rVal = evalAtom(arithMatch[3].trim(), resolveReg)
    if (lVal === null || rVal === null) return '?'
    const op = arithMatch[2]
    let result: number
    if (op === '+') result = lVal + rVal
    else if (op === '-') result = lVal - rVal
    else result = lVal * rVal
    return '0x' + BigInt.asUintN(64, BigInt(result)).toString(16) + ` (${result})`
  }
  const val = evalAtom(e, resolveReg)
  if (val !== null) return '0x' + BigInt.asUintN(64, BigInt(val)).toString(16) + ` (${val})`
  return '? expression non reconnue'
}

function evalAtom(token: string, resolveReg: (t: string) => number | null): number | null {
  const t = token.trim()
  const reg = resolveReg(t)
  if (reg !== null) return reg
  if (t.startsWith('0x')) { const n = parseInt(t, 16); return isNaN(n) ? null : n }
  const n = parseInt(t, 10)
  return isNaN(n) ? null : n
}

const FLAG_DESCS: Record<string, string> = {
  ZF: 'Zero Flag — 1 si le résultat est zéro',
  CF: 'Carry Flag — 1 si retenue/emprunt (non-signé)',
  SF: 'Sign Flag — 1 si le résultat est négatif (bit de poids fort = 1)',
  OF: 'Overflow Flag — 1 si débordement signé',
  PF: 'Parity Flag — 1 si l\'octet bas a un nombre pair de bits à 1',
  AF: 'Auxiliary Flag — retenue du bit 3 vers le bit 4 (BCD)',
  DF: 'Direction Flag — sens des opérations string (0=croissant, 1=décroissant)',
}

export default function AsmDebugger() {
  const [code, setCode] = useState('')
  const [step, setStep] = useState(0)
  const [traceSteps, setTraceSteps] = useState<StepSnapshot[]>([EMPTY_SNAP])
  const [hideUnchanged, setHideUnchanged] = useState(false)
  const [showUpper, setShowUpper] = useState(false)
  const [displayMode, setDisplayMode] = useState<'hex' | 'dec' | 'bin'>('dec')
  const [lexSearch, setLexSearch] = useState('')
  const [lexTab, setLexTab] = useState<'instructions' | 'syscalls'>('instructions')
  const [refSubTab, setRefSubTab] = useState<'lexique' | 'convention' | 'adressage'>('lexique')
  const [asmFlavor, setAsmFlavor] = useState('nasm')
  const [termOutput, setTermOutput] = useState<string[]>([])
  const [termVisible, setTermVisible] = useState(false)
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set())
  const [autoStepSpeed, setAutoStepSpeed] = useState(500)
  const autoStepRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [isAutoStepping, setIsAutoStepping] = useState(false)
  const [evalExpr, setEvalExpr] = useState('')
  const [evalHistory, setEvalHistory] = useState<{ expr: string; value: string }[]>([])
  const [watchpoints, setWatchpoints] = useState<{ expr: string; kind: string; id: string }[]>([])
  const [watchExpr, setWatchExpr] = useState('')
  const [gdbCmdInput, setGdbCmdInput] = useState('')
  const [stdinInput, setStdinInput] = useState('')
  const [termFloating, setTermFloating] = useState(false)
  const [stdinSplitPct, setStdinSplitPct] = useState(50)
  const [fabOpen, setFabOpen] = useState(false)
  const [gdbConsoleHistory, setGdbConsoleHistory] = useState<{ cmd: string; output: string }[]>([])
  const [programArgs, setProgramArgs] = useState('')
  const [editingReg, setEditingReg] = useState<string | null>(null)
  const [editRegValue, setEditRegValue] = useState('')
  const [sectionEntries, setSectionEntries] = useState<Record<string, { addr: number; val: number }[]>>({})
  const [toasts, setToasts] = useState<Toast[]>([])
  const [refModalOpen, setRefModalOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [emptyDismissed, setEmptyDismissed] = useState(false)
  const [snippetsOpen, setSnippetsOpen] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [stackCollapsed, setStackCollapsed] = useState(true)
  const [memoryCollapsed, setMemoryCollapsed] = useState(true)
  const [securityCollapsed, setSecurityCollapsed] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [evalOpen, setEvalOpen] = useState(false)
  const [tourOpen, setTourOpen] = useState(shouldShowTour)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem('asmble_theme')
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })
  const [codeHistory, setCodeHistory] = useState<HistoryEntry[]>(loadHistory)
  const gdb = useGdbSession()

  // Persist theme
  useEffect(() => { localStorage.setItem('asmble_theme', theme) }, [theme])

  // Listen for system preference changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('asmble_theme')) setTheme(e.matches ? 'light' : 'dark')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Restore last code from history on mount
  useEffect(() => {
    const h = loadHistory()
    if (h.length > 0 && !code) { setCode(h[0].code); setEmptyDismissed(true) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const addToast = useCallback((msg: string, kind: Toast['kind'] = 'error') => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, msg, kind }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toggleBreakpoint = useCallback((line: number) => {
    setBreakpoints(prev => {
      const next = new Set(prev)
      if (next.has(line)) {
        next.delete(line)
        if (IS_LIVE) gdb.removeBreakpoint(line)
      } else {
        next.add(line)
        if (IS_LIVE) gdb.addBreakpoint(line)
      }
      return next
    })
  }, [gdb])

  const stopAutoStep = useCallback(() => {
    if (autoStepRef.current) { clearInterval(autoStepRef.current); autoStepRef.current = null }
    setIsAutoStepping(false)
  }, [])

  const startAutoStep = useCallback(() => {
    stopAutoStep()
    setIsAutoStepping(true)
    if (!IS_LIVE) {
      autoStepRef.current = setInterval(() => {
        setStep(s => {
          const next = s + 1
          if (next >= traceSteps.length) { stopAutoStep(); return s }
          if (breakpoints.has(traceSteps[next].ip)) { stopAutoStep(); return next }
          return next
        })
      }, autoStepSpeed)
    }
  }, [autoStepSpeed, breakpoints, stopAutoStep, traceSteps])

  useEffect(() => () => { if (autoStepRef.current) clearInterval(autoStepRef.current) }, [])

  const [isTracing, setIsTracing] = useState(false)

  const handleRun = async () => {
    saveToHistory(code)
    setCodeHistory(loadHistory())
    if (IS_LIVE) {
      stopAutoStep()
      gdb.connect(code, asmFlavor, 'run')
      setTermOutput(['▶ Exécution...'])
      setTermVisible(true)
      return
    }
    stopAutoStep()
    setTermOutput(['Assembling & tracing with GDB...'])
    setTermVisible(true)
    setIsTracing(true)
    try {
      const res = await fetch('/api/trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, flavor: asmFlavor }),
      })
      const data = await res.json()
      if (!data.success) {
        const msgs = data.output ?? ['Assembly failed']
        msgs.forEach((m: string) => addToast(m, 'error'))
        setTermOutput(msgs)
      } else {
        const steps: StepSnapshot[] = data.steps ?? []
        if (steps.length > 0) { setTraceSteps(steps); setStep(0) }
        setTermOutput(data.output?.length ? data.output : ['Program traced successfully.'])
      }
    } catch {
      addToast('Build server unavailable — start the dev server.', 'error')
      setTermOutput(['[error] Build server unavailable — start the dev server (npm run dev).'])
    } finally {
      setIsTracing(false)
    }
  }

  const handleRunToBreakpoint = useCallback(() => {
    if (IS_LIVE) { gdb.continueExec(); return }
    if (breakpoints.size === 0) { setStep(traceSteps.length - 1); stopAutoStep(); return }
    setStep(s => {
      for (let i = s + 1; i < traceSteps.length; i++) {
        if (breakpoints.has(traceSteps[i].ip)) return i
      }
      return traceSteps.length - 1
    })
  }, [gdb, breakpoints, stopAutoStep, traceSteps])

  const { cols, bodyRef, onDown: onColDown } = useColResize([30, 36, 34])
  const { h: termH, rootRef, onDown: onTermDown } = useTermResize(200)
  const stdinDragRef = useRef<{ dragging: boolean; host: HTMLElement | null }>({ dragging: false, host: null })

  const onStdinSplitDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    stdinDragRef.current.dragging = true
    stdinDragRef.current.host = (e.currentTarget.parentElement as HTMLElement) || null
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!stdinDragRef.current.dragging || !stdinDragRef.current.host) return
      const rect = stdinDragRef.current.host.getBoundingClientRect()
      if (rect.height <= 0) return
      const pct = ((e.clientY - rect.top) / rect.height) * 100
      setStdinSplitPct(Math.max(25, Math.min(75, pct)))
    }
    const onUp = () => {
      if (!stdinDragRef.current.dragging) return
      stdinDragRef.current.dragging = false
      stdinDragRef.current.host = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // ── Live mode: feed GDB snapshots into step history ──
  const liveHistory = gdb.history
  const [liveStepIdx, setLiveStepIdx] = useState(-1)

  // Live mode auto-step
  const autoStepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!IS_LIVE || !isAutoStepping) return
    if (gdb.state !== 'connected' || gdb.stepping) return
    const lastSnap = liveHistory[liveHistory.length - 1]
    if (lastSnap && lastSnap.ip === 0 && lastSnap.instr?.includes('terminé')) { stopAutoStep(); return }
    autoStepTimerRef.current = setTimeout(() => { gdb.step() }, autoStepSpeed)
    return () => { if (autoStepTimerRef.current) clearTimeout(autoStepTimerRef.current) }
  }, [isAutoStepping, gdb.stepping, gdb.state, liveHistory.length, autoStepSpeed, stopAutoStep])

  useEffect(() => { if (liveHistory.length > 0) setLiveStepIdx(liveHistory.length - 1) }, [liveHistory.length])

  // Terminal output from GDB events
  useEffect(() => {
    if (gdb.state === 'connected') setTermOutput(prev => [...prev, '✓ Connected to GDB'])
    else if (gdb.state === 'error') setTermOutput(prev => [...prev, '[error] WebSocket connection failed'])
    else if (gdb.state === 'disconnected') setTermOutput(prev => [...prev, '⚡ Disconnected'])
  }, [gdb.state])

  useEffect(() => {
    if (gdb.error) {
      addToast(gdb.error, 'error')
      setTermOutput(prev => {
        const msg = `[error] ${gdb.error}`
        return prev[prev.length - 1] === msg ? prev : [...prev, msg]
      })
    }
  }, [gdb.error, addToast])

  const prevSnapshotCount = useRef(0)
  useEffect(() => {
    if (gdb.history.length === 0) { prevSnapshotCount.current = 0; return }
    if (gdb.history.length > prevSnapshotCount.current) {
      const snap = gdb.history[gdb.history.length - 1]
      if (snap.ip === 0 && snap.instr?.includes('terminé')) setTermOutput(prev => [...prev, `✓ ${snap.annotation}`])
    }
    prevSnapshotCount.current = gdb.history.length
  }, [gdb.history])

  const prevOutputLen = useRef(0)
  useEffect(() => {
    if (gdb.programOutput.length === 0) { prevOutputLen.current = 0; return }
    const newLines = gdb.programOutput.slice(prevOutputLen.current)
    if (newLines.length > 0) { setTermOutput(prev => [...prev, ...newLines]); prevOutputLen.current = gdb.programOutput.length }
  }, [gdb.programOutput])

  useEffect(() => { if (gdb.evalResult) setEvalHistory(prev => [...prev, gdb.evalResult!]) }, [gdb.evalResult])
  useEffect(() => { if (gdb.gdbOutput) setGdbConsoleHistory(prev => [...prev, gdb.gdbOutput!]) }, [gdb.gdbOutput])
  useEffect(() => { if (gdb.sectionData) setSectionEntries(prev => ({ ...prev, [gdb.sectionData!.name]: gdb.sectionData!.entries })) }, [gdb.sectionData])

  // ── Derived state ──
  const steps = IS_LIVE ? liveHistory : traceSteps
  const currentStep = IS_LIVE ? Math.max(0, liveStepIdx) : Math.min(step, traceSteps.length - 1)
  const cur = (steps[currentStep] ?? EMPTY_SNAP) as StepSnapshot
  const prev = currentStep > 0 ? (steps[currentStep - 1] as StepSnapshot) : null
  const canBack = IS_LIVE ? currentStep > 0 && !gdb.stepping : step > 0
  const atLatest = IS_LIVE ? currentStep >= liveHistory.length - 1 : false
  const canForward = IS_LIVE ? (gdb.state === 'connected' && !gdb.stepping) : step < traceSteps.length - 1
  const canStdin = IS_LIVE && gdb.state === 'connected' && !gdb.programExited
  const totalLines = code.split('\n').length
  const activeLine = (IS_LIVE && cur.changed.length === 0) ? 0 : Math.max(1, Math.min(cur.ip, totalLines))
  const initRegs = (steps[0] ?? EMPTY_SNAP).regs
  const mainRegs = hideUnchanged ? MAIN_REGS.filter(r => cur.regs[r] !== initRegs[r]) : MAIN_REGS
  const extRegs = hideUnchanged ? REG_EXT.filter(r => cur.regs[r] !== initRegs[r]) : REG_EXT

  // ── Breadcrumb (section > label > instruction) ──
  const breadcrumb = useMemo(() => {
    if (activeLine <= 0) return []
    const parts: string[] = []
    const codeLines = code.split('\n')
    // Find enclosing section and label
    for (let i = activeLine - 1; i >= 0; i--) {
      const line = codeLines[i]?.trim() || ''
      if (!parts.some(p => p.startsWith('.')) && /^section\s+(\.\w+)/i.test(line)) {
        parts.unshift(line.match(/^section\s+(\.\w+)/i)![1])
      }
      if (parts.length < 2 && /^[a-zA-Z_.@$][a-zA-Z0-9_.@$]*:/.test(line)) {
        const lbl = line.match(/^([a-zA-Z_.@$][a-zA-Z0-9_.@$]*):/)?.[1]
        if (lbl && !parts.includes(lbl)) parts.splice(parts.length, 0, lbl)
      }
      if (parts.length >= 2) break
    }
    if (cur.instr) parts.push(cur.instr)
    return parts
  }, [activeLine, code, cur.instr])

  // ── Register history for sparklines ──
  const regHistory = useMemo(() => {
    const stepsSlice = steps.slice(0, currentStep + 1)
    const last = stepsSlice.slice(-20) // last 20 steps max
    const result: Record<string, number[]> = {}
    const allRegs = [...MAIN_REGS, ...REG_EXT]
    for (const r of allRegs) {
      result[r] = last.map(s => s.regs[r] ?? 0)
    }
    return result
  }, [steps, currentStep])

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen(v => !v)
      }
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'F5') {
        e.preventDefault()
        if (e.shiftKey) { if (IS_LIVE) { gdb.reset(); setLiveStepIdx(-1) } else { setStep(0) }; stopAutoStep() }
        else { if (IS_LIVE && gdb.state === 'connected') gdb.continueExec(); else handleRun() }
      } else if (e.key === 'F10') {
        e.preventDefault()
        if (IS_LIVE) { if (liveStepIdx >= liveHistory.length - 1) gdb.stepOver(); else setLiveStepIdx(i => i + 1) }
        else setStep(s => Math.min(s + 1, traceSteps.length - 1))
      } else if (e.key === 'F11') {
        e.preventDefault()
        if (e.shiftKey) { if (IS_LIVE) gdb.stepOut() }
        else { if (IS_LIVE) { if (liveStepIdx >= liveHistory.length - 1) gdb.step(); else setLiveStepIdx(i => i + 1) } else setStep(s => Math.min(s + 1, traceSteps.length - 1)) }
      } else if (e.key === 'F9') {
        e.preventDefault()
        if (activeLine > 0) toggleBreakpoint(activeLine)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [gdb, stopAutoStep, handleRun, liveStepIdx, liveHistory.length, traceSteps.length, activeLine, toggleBreakpoint])

  // ── Command palette entries ──
  const paletteCommands = useMemo(() => {
    type PCmd = { label: string; cat: string; action: () => void }
    const cmds: PCmd[] = [
      { label: 'Build & Run', cat: 'Action', action: () => handleRun() },
      { label: 'Reset', cat: 'Action', action: () => { if (IS_LIVE) { gdb.reset(); setLiveStepIdx(-1) } else { setStep(0) }; stopAutoStep() } },
      { label: 'Step Next', cat: 'Action', action: () => { if (IS_LIVE) { if (liveStepIdx >= liveHistory.length - 1) gdb.step(); else setLiveStepIdx(i => i + 1) } else setStep(s => Math.min(s + 1, traceSteps.length - 1)) } },
      { label: 'Step Back', cat: 'Action', action: () => { if (IS_LIVE) setLiveStepIdx(i => Math.max(0, i - 1)); else setStep(s => Math.max(0, s - 1)) } },
      { label: 'Continue to Breakpoint', cat: 'Action', action: () => handleRunToBreakpoint() },
      { label: 'Auto-step Play', cat: 'Action', action: () => startAutoStep() },
      { label: 'Auto-step Pause', cat: 'Action', action: () => stopAutoStep() },
      { label: 'Toggle Terminal', cat: 'View', action: () => setTermVisible(v => !v) },
      { label: 'Toggle Console GDB', cat: 'View', action: () => setConsoleOpen(v => !v) },
      { label: 'Toggle Eval', cat: 'View', action: () => setEvalOpen(v => !v) },
      { label: 'Toggle Right Panel', cat: 'View', action: () => setRightCollapsed(v => !v) },
      { label: 'Open Reference', cat: 'View', action: () => setRefModalOpen(true) },
      { label: 'Display: HEX', cat: 'Display', action: () => setDisplayMode('hex') },
      { label: 'Display: DEC', cat: 'Display', action: () => setDisplayMode('dec') },
      { label: 'Display: BIN', cat: 'Display', action: () => setDisplayMode('bin') },
      { label: 'Toggle Hide Unchanged', cat: 'View', action: () => setHideUnchanged(v => !v) },
      { label: 'Toggle Upper 32 bits', cat: 'View', action: () => setShowUpper(v => !v) },
      { label: 'Tour guidé', cat: 'Aide', action: () => setTourOpen(true) },
    ]
    LEXICON_INSTRS.forEach(i => cmds.push({ label: `${i.name} — ${i.desc.slice(0, 50)}`, cat: 'Instruction', action: () => { setRefModalOpen(true); setRefSubTab('lexique'); setLexTab('instructions'); setLexSearch(i.name) } }))
    SYSCALLS.forEach(s => cmds.push({ label: `syscall ${s.num}: ${s.name}`, cat: 'Syscall', action: () => { setRefModalOpen(true); setRefSubTab('lexique'); setLexTab('syscalls'); setLexSearch(s.name) } }))
    return cmds
  }, [handleRun, handleRunToBreakpoint, startAutoStep, stopAutoStep, gdb, liveStepIdx, liveHistory.length, traceSteps.length])

  // ── Watchpoint handlers ──
  const handleAddWatchpoint = useCallback((expr: string) => {
    gdb.addWatchpoint(expr)
    setWatchpoints(prev => [...prev, { expr, kind: 'write', id: '' }])
    setWatchExpr('')
  }, [gdb])

  const handleRemoveWatchpoint = useCallback((idx: number, id: string) => {
    if (id) gdb.removeWatchpoint(id)
    setWatchpoints(prev => prev.filter((_, j) => j !== idx))
  }, [gdb])

  const renderTerminalLines = () => termOutput.map((line, i) => {
    const cls = line.startsWith('$')
      ? 'cmd'
      : line.toLowerCase().includes('error')
        ? 'err'
        : line.startsWith('►')
          ? 'step'
          : line.startsWith('  ↳')
            ? 'output'
            : 'out'
    return <div key={i} className={`asm-terminal-line ${cls}`}>{line}</div>
  })

  const renderTerminalInput = () => (
    <form
      className="asm-terminal-stdin-pane"
      onSubmit={e => {
        e.preventDefault()
        if (!stdinInput) return
        gdb.sendStdin(stdinInput + '\n')
        setTermOutput(prev => [...prev, `< ${stdinInput}`])
        setStdinInput('')
      }}
    >
      <div className="asm-terminal-stdin-head">stdin</div>
      <div className="asm-terminal-stdin-row">
        <span className="asm-terminal-stdin-prompt">&gt;</span>
        <input
          className="asm-terminal-stdin-input"
          value={stdinInput}
          onChange={e => setStdinInput(e.target.value)}
          placeholder="stdin (entrée programme)..."
          autoComplete="off"
        />
      </div>
    </form>
  )

  const renderTerminalPanel = (floating: boolean) => (
    <>
      <div className={floating ? 'asm-terminal-float-header' : 'asm-terminal-drawer-bar'} onClick={floating ? undefined : () => setTermVisible(v => !v)}>
        <span className="asm-terminal-title">Terminal</span>
        <span className="asm-terminal-count">{termOutput.length > 0 ? `${termOutput.length} ligne${termOutput.length > 1 ? 's' : ''}` : ''}</span>
        <div className="asm-terminal-actions" onClick={e => e.stopPropagation()}>
          <button className="asm-terminal-action" onClick={() => setTermOutput([])} data-tip="Vider le terminal">clear</button>
          {!floating && <button className="asm-terminal-action" onClick={() => { setTermFloating(true); setTermVisible(true) }} data-tip="Agrandir en modal"><i className="fa-solid fa-expand" /></button>}
          {floating && <button className="asm-terminal-action" onClick={() => setTermFloating(false)} data-tip="Réduire vers le panneau"><i className="fa-solid fa-compress" /></button>}
          <button className="asm-terminal-action" onClick={() => setTermVisible(v => !v)} data-tip={termVisible ? 'Réduire le terminal' : 'Agrandir le terminal'}>{termVisible ? '\u25BC' : '\u25B2'}</button>
        </div>
      </div>
      {termVisible && (
        canStdin ? (
          <div className="asm-terminal-split">
            <div className="asm-terminal-output-pane" style={{ height: `${stdinSplitPct}%` }}>
              <div className="asm-terminal-output-head">stdout / stderr</div>
              <div className="asm-terminal-output-scroll" ref={el => { if (el) el.scrollTop = el.scrollHeight }}>
                {renderTerminalLines()}
              </div>
            </div>
            <div className="asm-terminal-split-handle" onMouseDown={onStdinSplitDown} />
            <div className="asm-terminal-input-pane" style={{ height: `${100 - stdinSplitPct}%` }}>
              {renderTerminalInput()}
            </div>
          </div>
        ) : (
          <div className="asm-terminal-body" ref={el => { if (el) el.scrollTop = el.scrollHeight }}>
            {renderTerminalLines()}
            <div className="asm-terminal-cursor">$ <span className="asm-terminal-blink">|</span></div>
          </div>
        )
      )}
    </>
  )

  return (
    <div className="asm-root" ref={rootRef} data-theme={theme}>
      {/* Header */}
      <div className="asm-header">
        <span className="asm-logo">
          &#9656; ASM<span className="asm-logo-accent">BLE</span>
        </span>
        <select className="asm-flavor-select" value={asmFlavor} onChange={e => setAsmFlavor(e.target.value)}>
          <option value="nasm">NASM x86-64</option>
          <option value="gas">GAS (AT&amp;T)</option>
          <option value="masm">MASM</option>
          <option value="fasm">FASM</option>
        </select>
        {IS_LIVE && (
          <input
            className="asm-args-input"
            value={programArgs}
            onChange={e => setProgramArgs(e.target.value)}
            onBlur={() => { if (programArgs && gdb.state === 'connected') gdb.setArgs(programArgs) }}
            placeholder="args du programme..."
            title="Arguments passés au programme"
          />
        )}
        <button className="asm-ref-btn" onClick={() => setRefModalOpen(true)} data-tip="Référence x86-64
Instructions, syscalls, convention d'appel"><i className="fa-solid fa-book" /> Ref</button>
        <button className="asm-ref-btn" onClick={() => setPaletteOpen(true)} data-tip="Palette de commandes
Raccourci : Ctrl+K"><i className="fa-solid fa-terminal" /> Ctrl+K</button>
        <button className="asm-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} data-tip={`Thème : ${theme === 'dark' ? 'sombre' : 'clair'}\nCliquer pour basculer`}><i className={`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`} /></button>
        <div className="asm-controls">
          {/* Exécution */}
          <div className="asm-ctrl-group">
            <span className="asm-ctrl-label">Exécution</span>
            <div className="asm-ctrl-buttons">
              <button className="asm-btn run" onClick={handleRun} disabled={isTracing} data-tip="Assembler et exécuter le programme
Raccourci : F5">{isTracing ? <><i className="fa-solid fa-spinner fa-pulse" /> Tracing…</> : <><i className="fa-solid fa-play" /> Build & Run</>}</button>
              <button className="asm-btn" onClick={handleRunToBreakpoint} data-tip="Continuer jusqu'au prochain breakpoint
Raccourci : Shift+F5"><i className="fa-solid fa-forward-step" /> Breakpoint</button>
              {IS_LIVE && <button className="asm-btn" onClick={() => gdb.continueExec()} disabled={gdb.state !== 'connected' || gdb.stepping} data-tip="Continue l'exécution jusqu'au
prochain breakpoint ou la fin du programme"><i className="fa-solid fa-forward" /> Continue</button>}
            </div>
          </div>
          <div className="asm-ctrl-sep" />
          {/* Stepping */}
          <div className="asm-ctrl-group">
            <span className="asm-ctrl-label">Pas à pas</span>
            <div className="asm-ctrl-buttons">
              <button className={`asm-btn ${canBack ? 'active' : ''}`} disabled={!canBack} onClick={() => { if (IS_LIVE) { setLiveStepIdx(i => Math.max(0, i - 1)) } else { setStep(s => s - 1) } }} data-tip="Revenir au step précédent
Navigue dans l'historique d'exécution"><i className="fa-solid fa-chevron-left" /> Back</button>
              <button className={`asm-btn primary ${canForward ? 'active' : ''}`} disabled={!canForward} onClick={() => { if (IS_LIVE) { if (!atLatest) { setLiveStepIdx(i => i + 1) } else { gdb.step() } } else { setStep(s => s + 1) } }} data-tip="Exécuter l'instruction suivante
Raccourci : F11 (Step Into)">Next <i className="fa-solid fa-chevron-right" /></button>
              {IS_LIVE && <button className={`asm-btn ${canForward && atLatest ? 'active' : ''}`} disabled={!canForward || !atLatest} onClick={() => gdb.stepOver()} data-tip="Step over : exécute sans entrer
dans les CALL/fonctions
Raccourci : F10"><i className="fa-solid fa-share" /> Over</button>}
              {IS_LIVE && <button className={`asm-btn ${canForward && atLatest ? 'active' : ''}`} disabled={!canForward || !atLatest} onClick={() => gdb.stepOut()} data-tip="Step out : termine la fonction
en cours et revient à l'appelant
Raccourci : Shift+F11"><i className="fa-solid fa-arrow-up-from-bracket" /> Out</button>}
              <span className={`asm-step-count${gdb.stepping ? ' stepping' : ''}`}>{IS_LIVE ? `step ${currentStep + 1}` : `step ${currentStep + 1}/${steps.length || '?'}`}</span>
            </div>
          </div>
          <div className="asm-ctrl-sep" />
          {/* Auto-step */}
          <div className="asm-ctrl-group">
            <span className="asm-ctrl-label">Auto</span>
            <div className="asm-ctrl-buttons">
              {isAutoStepping ? (
                <button className="asm-btn active" onClick={stopAutoStep} data-tip="Pause le stepping automatique"><i className="fa-solid fa-pause" /> Pause</button>
              ) : (
                <button className="asm-btn" onClick={startAutoStep} data-tip="Lancer le stepping automatique
Avance d'un step toutes les Xms"><i className="fa-solid fa-play" /> Play</button>
              )}
              <input type="range" className="asm-speed-slider" min="100" max="2000" step="100" value={autoStepSpeed} onChange={e => setAutoStepSpeed(Number(e.target.value))} title={`Vitesse : ${autoStepSpeed}ms par step`} />
              <span className="asm-speed-label">{autoStepSpeed}ms</span>
            </div>
          </div>
          <div className="asm-ctrl-sep" />
          {/* Reset */}
          <button className="asm-btn" onClick={() => { if (IS_LIVE) { gdb.reset(); setLiveStepIdx(-1) } else { setStep(0) }; stopAutoStep() }} data-tip="Revenir au début du programme
Recharge le binaire dans GDB"><i className="fa-solid fa-rotate-left" /> Reset</button>
          {IS_LIVE && <span className={`asm-live-dot ${gdb.state}`} title={`Connexion : ${gdb.state}`} />}
        </div>
      </div>

      {/* Body: 3 columns */}
      <div className="asm-body" ref={bodyRef}>
        {/* COL 1: Editor */}
        <div className="asm-col asm-col-editor" style={{ width: cols[0] + '%' }}>
          <div className="asm-col-header">
            <span>source.asm</span>
            <div className="asm-file-actions">
              <button className="asm-file-btn" data-tip="Importer un fichier .asm depuis le disque" data-tip-pos="bottom" onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = '.asm,.s,.nasm'
                input.onchange = () => {
                  const file = input.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = () => { if (typeof reader.result === 'string') { setCode(reader.result); setEmptyDismissed(true) } }
                  reader.readAsText(file)
                }
                input.click()
              }}><i className="fa-solid fa-folder-open" /> Import</button>
              <button className="asm-file-btn" data-tip="Exporter le code en fichier .asm" data-tip-pos="bottom" onClick={() => {
                const blob = new Blob([code], { type: 'text/plain' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url; a.download = 'source.asm'; a.click()
                URL.revokeObjectURL(url)
              }}><i className="fa-solid fa-floppy-disk" /> Export</button>
              {codeHistory.length > 0 && (
                <select
                  className="asm-file-btn asm-history-select"
                  value=""
                  onChange={e => {
                    const idx = Number(e.target.value)
                    if (!isNaN(idx) && codeHistory[idx]) { setCode(codeHistory[idx].code); setEmptyDismissed(true) }
                  }}
                  title="Historique des programmes"
                >
                  <option value="" disabled>⏱ Historique</option>
                  {codeHistory.map((h, i) => (
                    <option key={h.ts} value={i}>{h.label} — {new Date(h.ts).toLocaleTimeString()}</option>
                  ))}
                </select>
              )}
              <div className="asm-snippets-wrapper">
                <button className="asm-file-btn" onClick={() => setSnippetsOpen(v => !v)} title="Snippets templates"><i className="fa-solid fa-file-code" /> Snippets</button>
                {snippetsOpen && (
                  <div className="asm-snippets-dropdown">
                    {SNIPPETS.map(s => (
                      <button key={s.name} className="asm-snippet-item" onClick={() => {
                        if (!code.trim() || confirm(`Remplacer le code actuel par "${s.name}" ?`)) {
                          setCode(s.code); setEmptyDismissed(true)
                        }
                        setSnippetsOpen(false)
                      }}>{s.name}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className={`asm-annotation asm-annotation-editor ${cur.jumped ? 'jumped' : ''}`}>
            {cur.jumped && <span className="asm-jump-badge small"><i className="fa-solid fa-bolt" /> JUMP</span>}
            <span>{cur.annotation}</span>
          </div>
          {code.length === 0 && !emptyDismissed && (
            <div className="asm-empty-state">
              <div className="asm-empty-icon"><i className="fa-solid fa-microchip" /></div>
              <div className="asm-empty-title">Écrivez du code assembleur x86-64</div>
              <div className="asm-empty-hint">ou choisissez un template pour commencer</div>
              <div className="asm-empty-templates">
                <button className="asm-empty-tpl blank" onClick={() => setEmptyDismissed(true)}>Format vierge</button>
                {SNIPPETS.slice(0, 4).map(s => (
                  <button key={s.name} className="asm-empty-tpl" onClick={() => { setEmptyDismissed(true); setCode(s.code) }}>{s.name}</button>
                ))}
              </div>
              <div className="asm-empty-shortcut">Ctrl+K pour la palette de commandes</div>
            </div>
          )}
          <AsmEditor code={code} onChange={setCode} activeLine={activeLine} breakpoints={breakpoints} onToggleBreakpoint={toggleBreakpoint} regValues={cur.regs} changedRegs={cur.changed} breadcrumb={breadcrumb} />
        </div>
        <div className="asm-resize-handle asm-resize-col" onMouseDown={onColDown(0)} />

        {/* COL 2: Registers + Flags */}
        <div className="asm-col asm-col-regs" style={{ width: rightCollapsed ? `calc(${cols[1] + cols[2]}% - 28px)` : cols[1] + '%' }}>
          <div className="asm-regs-pane-scroll">
            <div className="asm-regs-section">
              <div className="asm-regs-header">
                <span className="asm-section-title">Registres</span>
                <div className="asm-regs-filters">
                  <button className={`asm-regs-toggle ${hideUnchanged ? 'on' : ''}`} onClick={() => setHideUnchanged(v => !v)} data-tip="Afficher uniquement les registres modifiés">modifiés</button>
                  <button className={`asm-regs-toggle ${showUpper ? 'on' : ''}`} onClick={() => setShowUpper(v => !v)} data-tip="Afficher les bits 63:32 des registres">63:32</button>
                  <button className="asm-regs-toggle on" onClick={() => setDisplayMode(m => m === 'hex' ? 'dec' : m === 'dec' ? 'bin' : 'hex')} data-tip="Basculer hex / décimal / binaire">{displayMode === 'hex' ? '0x' : displayMode === 'dec' ? 'dec' : 'bin'}</button>
                </div>
              </div>
              <div className={`asm-rip-bar ${cur.changed.includes('rip') ? 'changed' : ''}`}>
                <span className="asm-rip-label">RIP</span>
                <span className="asm-rip-val" title={`hex: 0x${BigInt.asUintN(64, BigInt(cur.regs.rip)).toString(16)}\ndec: ${cur.regs.rip}\nbin: 0b${BigInt.asUintN(64, BigInt(cur.regs.rip)).toString(2)}`}>0x{BigInt.asUintN(64, BigInt(cur.regs.rip)).toString(16)}</span>
                <span className="asm-rip-instr">{cur.instr}</span>
              </div>
              <div className="asm-regcards-list">
                {mainRegs.map(r => (
                  <div key={r} onDoubleClick={() => { if (IS_LIVE) { setEditingReg(r); setEditRegValue('0x' + BigInt.asUintN(64, BigInt(cur.regs[r])).toString(16)) } }}>
                    {editingReg === r ? (
                      <div className="asm-reg-edit">
                        <span className="asm-reg-edit-name">{r}</span>
                        <input
                          className="asm-reg-edit-input"
                          value={editRegValue}
                          onChange={e => setEditRegValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const val = parseInt(editRegValue, editRegValue.startsWith('0x') ? 16 : 10)
                              if (!isNaN(val)) gdb.setRegister(r, val)
                              setEditingReg(null)
                            } else if (e.key === 'Escape') {
                              setEditingReg(null)
                            }
                          }}
                          onBlur={() => setEditingReg(null)}
                          autoFocus
                        />
                      </div>
                    ) : (
                      <RegCard name={r} val={cur.regs[r]} prevVal={prev ? prev.regs[r] : null} changed={cur.changed.includes(r)} showUpper={showUpper} displayMode={displayMode} history={regHistory[r]} />
                    )}
                  </div>
                ))}
              </div>
              <div className="asm-regext-grid">
                {extRegs.map(r => (
                  <RegExtRow key={r} name={r} val={cur.regs[r]} prevVal={prev ? prev.regs[r] : null} changed={cur.changed.includes(r)} displayMode={displayMode} history={regHistory[r]} />
                ))}
              </div>
              {hideUnchanged && mainRegs.length === 0 && extRegs.length === 0 && (
                <div className="asm-empty">Aucun registre modifié à ce step.</div>
              )}
            </div>
            <div className="asm-flags-inline">
              {Object.entries(cur.flags).map(([flag, val]) => {
                const isActive = val === 1 || val === true
                const wasActive = prev ? (prev.flags[flag] === 1 || prev.flags[flag] === true) : false
                const justChanged = prev !== null && isActive !== wasActive
                return (
                  <span key={flag} className={`asm-flag-pill ${isActive ? 'active' : ''} ${justChanged ? 'pulse' : ''}`} title={FLAG_DESCS[flag] || ''}>
                    {flag}
                  </span>
                )
              })}
              {cur.flagHint && <span className="asm-flag-hint-inline">{cur.flagHint}</span>}
            </div>
          </div>

          {!termFloating && (
            <div className={`asm-terminal-drawer asm-terminal-docked ${termVisible ? 'open' : ''}`} style={termVisible ? { height: termH + 34 } : undefined}>
              {termVisible && <div className="asm-terminal-resize" onMouseDown={onTermDown} />}
              {renderTerminalPanel(false)}
            </div>
          )}
        </div>
        {!rightCollapsed && <div className="asm-resize-handle asm-resize-col" onMouseDown={onColDown(1)} />}

        {/* COL 3: Panels (collapsible) */}
        {rightCollapsed ? (
          <div className="asm-col-collapsed" onClick={() => setRightCollapsed(false)} title="Expand panel">
            <span className="asm-col-collapsed-icon"><i className="fa-solid fa-chevron-left" /></span>
          </div>
        ) : (
        <div className="asm-col asm-col-right" style={{ width: cols[2] + '%' }}>
          <div className="asm-right-toolbar">
            <button className="asm-tab-collapse" onClick={() => setRightCollapsed(true)} data-tip="Replier le panneau droit"><i className="fa-solid fa-chevron-right" /></button>
            {IS_LIVE && <button className={`asm-right-tool ${consoleOpen ? 'active' : ''}`} onClick={() => setConsoleOpen(v => !v)} data-tip="Console GDB brute
Envoyez des commandes GDB directement"><i className="fa-solid fa-terminal" /> Console</button>}
            <button className={`asm-right-tool ${evalOpen ? 'active' : ''}`} onClick={() => setEvalOpen(v => !v)} data-tip="Évaluateur d'expressions
Calculez des expressions C/asm en live"><i className="fa-solid fa-calculator" /> Eval</button>
          </div>
          <div className="asm-stacked-panels">
            {/* Stack section */}
            <div className={`asm-panel-section ${stackCollapsed ? 'collapsed' : ''}`}>
              <div className="asm-panel-section-header" onClick={() => setStackCollapsed(v => !v)}>
                <span className="asm-panel-section-arrow">{stackCollapsed ? '\u25B6' : '\u25BC'}</span>
                <span className="asm-section-title">Stack</span>
              </div>
              {!stackCollapsed && (
                <div className="asm-panel-section-body">
                  <StackPanel
                    cur={cur} displayMode={displayMode} isLive={IS_LIVE}
                    watchExpr={watchExpr} setWatchExpr={setWatchExpr}
                    watchpoints={watchpoints}
                    onAddWatchpoint={handleAddWatchpoint}
                    onRemoveWatchpoint={handleRemoveWatchpoint}
                  />
                </div>
              )}
            </div>
            {/* Memory section */}
            <div className={`asm-panel-section ${memoryCollapsed ? 'collapsed' : ''}`}>
              <div className="asm-panel-section-header" onClick={() => setMemoryCollapsed(v => !v)}>
                <span className="asm-panel-section-arrow">{memoryCollapsed ? '\u25B6' : '\u25BC'}</span>
                <span className="asm-section-title">Memory</span>
              </div>
              {!memoryCollapsed && (
                <div className="asm-panel-section-body">
                  <MemoryPanel
                    cur={cur} isLive={IS_LIVE}
                    sectionEntries={sectionEntries}
                    onLoadSection={name => gdb.readSection(name)}
                  />
                </div>
              )}
            </div>
            {/* Security section */}
            {IS_LIVE && (
            <div className={`asm-panel-section ${securityCollapsed ? 'collapsed' : ''}`}>
              <div className="asm-panel-section-header" onClick={() => setSecurityCollapsed(v => !v)}>
                <span className="asm-panel-section-arrow">{securityCollapsed ? '\u25B6' : '\u25BC'}</span>
                <span className="asm-section-title">Security</span>
              </div>
              {!securityCollapsed && (
                <div className="asm-panel-section-body">
                  <SecurityPanel
                    checksec={gdb.checksecData}
                    vmmap={gdb.vmmapData}
                    got={gdb.gotData}
                    cyclicResult={gdb.cyclicResult}
                    cyclicFindResult={gdb.cyclicFindResult}
                    ropResult={gdb.ropResult}
                    connected={gdb.state === 'connected'}
                    onRequestChecksec={() => gdb.requestChecksec()}
                    onRequestVmmap={() => gdb.requestVmmap()}
                    onRequestGot={() => gdb.requestGot()}
                    onRequestCyclic={(len, n) => gdb.requestCyclic(len, n)}
                    onRequestCyclicFind={(val, n) => gdb.requestCyclicFind(val, n)}
                    onRequestRop={(filter) => gdb.requestRop(filter)}
                  />
                </div>
              )}
            </div>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Terminal modal */}
      {termFloating && termVisible && (
        <div className="asm-terminal-modal-overlay" onMouseDown={() => setTermFloating(false)}>
          <div className="asm-terminal-float" onMouseDown={e => e.stopPropagation()}>
            {renderTerminalPanel(true)}
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="asm-statusbar">
        <span className="asm-statusbar-item" onClick={() => setDisplayMode(m => m === 'hex' ? 'dec' : m === 'dec' ? 'bin' : 'hex')} title="Changer le mode d'affichage">
          {displayMode === 'hex' ? 'HEX' : displayMode === 'dec' ? 'DEC' : 'BIN'}
        </span>
        <span className="asm-statusbar-item">{asmFlavor.toUpperCase()}</span>
        <span className="asm-statusbar-item">{code.split('\n').length} lignes</span>
        <span className="asm-statusbar-item">{IS_LIVE ? `step ${currentStep + 1}` : `step ${currentStep + 1}/${steps.length || '?'}`}</span>
        {IS_LIVE && <span className={`asm-statusbar-dot ${gdb.state}`} title={gdb.state} />}
        {termOutput.length > 0 && !termVisible && (
          <span className="asm-statusbar-item asm-statusbar-mini-term" onClick={() => setTermVisible(true)} title="Dernier message — cliquer pour ouvrir">
            {termOutput[termOutput.length - 1]?.slice(0, 50)}
          </span>
        )}
        <span className="asm-statusbar-right">
          <span className="asm-statusbar-item asm-statusbar-ref" onClick={() => setTermVisible(v => !v)} title="Toggle terminal"><i className="fa-solid fa-display" /> Terminal</span>
          <span className="asm-statusbar-item asm-statusbar-ref" onClick={() => setPaletteOpen(true)} title="Ctrl+K"><i className="fa-solid fa-terminal" /> Palette</span>
        </span>
      </div>

      {/* Console GDB drawer */}
      {IS_LIVE && (
        <div className={`asm-console-drawer ${consoleOpen ? 'open' : ''}`}>
          <div className="asm-drawer-header">
            <span className="asm-section-title">Console GDB</span>
            <button className="asm-drawer-close" onClick={() => setConsoleOpen(false)}>&times;</button>
          </div>
          <div className="asm-drawer-body">
            <ConsolePanel
              isLive={IS_LIVE} connected={gdb.state === 'connected'}
              gdbCmdInput={gdbCmdInput} setGdbCmdInput={setGdbCmdInput}
              gdbConsoleHistory={gdbConsoleHistory} setGdbConsoleHistory={setGdbConsoleHistory}
              onGdbCommand={cmd => gdb.gdbCommand(cmd)}
            />
          </div>
        </div>
      )}

      {/* Eval popover */}
      {evalOpen && (
        <div className="asm-eval-popover">
          <div className="asm-eval-popover-header">
            <span className="asm-section-title">Eval</span>
            <button className="asm-drawer-close" onClick={() => setEvalOpen(false)}>&times;</button>
          </div>
          <div className="asm-eval-popover-body">
            <EvalPanel
              isLive={IS_LIVE} connected={gdb.state === 'connected'}
              evalExpr={evalExpr} setEvalExpr={setEvalExpr}
              evalHistory={evalHistory} setEvalHistory={setEvalHistory}
              onEvaluate={expr => gdb.evaluate(expr)}
              onLocalEval={expr => localEval(expr, cur)}
              cur={cur}
            />
          </div>
        </div>
      )}

      {/* Toast notifications */}
      <div className="asm-toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`asm-toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
            <span className="asm-toast-icon">{t.kind === 'error' ? <i className="fa-solid fa-xmark" /> : t.kind === 'success' ? <i className="fa-solid fa-check" /> : <i className="fa-solid fa-circle-info" />}</span>
            <span className="asm-toast-msg">{t.msg}</span>
          </div>
        ))}
      </div>

      {/* Command Palette */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={paletteCommands} />

      {/* Reference Modal */}
      <ReferenceModal
        open={refModalOpen} onClose={() => setRefModalOpen(false)}
        refSubTab={refSubTab} setRefSubTab={setRefSubTab}
        lexSearch={lexSearch} setLexSearch={setLexSearch}
        lexTab={lexTab} setLexTab={setLexTab}
      />

      {/* Guided Tour */}
      <GuidedTour open={tourOpen} onClose={() => setTourOpen(false)} onPrepare={action => {
        if (action === 'expand_right') { setRightCollapsed(false) }
        if (action === 'expand_stack') { setRightCollapsed(false); setStackCollapsed(false) }
        if (action === 'expand_memory') { setRightCollapsed(false); setMemoryCollapsed(false) }
        if (action === 'expand_security') { setRightCollapsed(false); setSecurityCollapsed(false) }
        if (action === 'open_console') { setConsoleOpen(true) }
        if (action === 'close_console') { setConsoleOpen(false) }
      }} />

      {/* FAB — Floating Action Button */}
      {fabOpen && (
        <div className="asm-fab-menu">
          <button className="asm-fab-item" onClick={() => { handleRun(); setFabOpen(false) }} data-tip="Build & Run"><i className="fa-solid fa-play" /></button>
          <button className="asm-fab-item" onClick={() => { setRefModalOpen(true); setFabOpen(false) }} data-tip="Référence x86-64"><i className="fa-solid fa-book" /></button>
          <button className="asm-fab-item" onClick={() => { setTheme(t => t === 'dark' ? 'light' : 'dark'); setFabOpen(false) }} data-tip={theme === 'dark' ? 'Thème clair' : 'Thème sombre'}><i className={`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`} /></button>
          <button className="asm-fab-item" onClick={() => { setTermVisible(v => !v); setFabOpen(false) }} data-tip="Terminal"><i className="fa-solid fa-display" /></button>
          <button className="asm-fab-item" onClick={() => { setConsoleOpen(v => !v); setFabOpen(false) }} data-tip="Console GDB"><i className="fa-solid fa-terminal" /></button>
        </div>
      )}
      <button className={`asm-fab ${fabOpen ? 'open' : ''}`} onClick={() => setFabOpen(f => !f)} data-tip="Actions rapides"><i className="fa-solid fa-bars" /></button>
    </div>
  )
}
