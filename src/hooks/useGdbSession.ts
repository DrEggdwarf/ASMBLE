import { useState, useRef, useCallback, useEffect } from 'react'
import type { StepSnapshot, ChecksecResult, VmmapEntry, GotEntry } from '../data/types'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

interface GdbSession {
  state: ConnectionState
  stepping: boolean
  programExited: boolean
  sessionId: string | null
  snapshot: StepSnapshot | null
  error: string | null
  history: StepSnapshot[]
  programOutput: string[]
  evalResult: { expr: string; value: string } | null
  gdbOutput: { cmd: string; output: string } | null
  sectionData: { name: string; entries: { addr: number; val: number }[] } | null
  checksecData: ChecksecResult | null
  vmmapData: VmmapEntry[] | null
  gotData: GotEntry[] | null
  cyclicResult: string | null
  cyclicFindResult: { value: string; offset: number } | null
  ropResult: { addr: string; gadget: string }[] | null

  connect: (code: string, flavor?: string, mode?: 'run' | 'assemble') => void
  step: () => void
  stepOver: () => void
  stepOut: () => void
  stepBack: () => void
  continueExec: () => void
  addBreakpoint: (line: number, condition?: string) => void
  removeBreakpoint: (line: number) => void
  addWatchpoint: (expr: string, kind?: string) => void
  removeWatchpoint: (id: string) => void
  evaluate: (expr: string) => void
  setRegister: (reg: string, value: number) => void
  setArgs: (args: string) => void
  gdbCommand: (cmd: string) => void
  readSection: (name: string) => void
  requestChecksec: () => void
  requestVmmap: () => void
  requestGot: () => void
  requestCyclic: (length: number, n?: number) => void
  requestCyclicFind: (value: string, n?: number) => void
  requestRop: (filter?: string) => void
  reset: () => void
  disconnect: () => void
}

export function useGdbSession(): GdbSession {
  const [state, setState] = useState<ConnectionState>('disconnected')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<StepSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<StepSnapshot[]>([])
  const [programOutput, setProgramOutput] = useState<string[]>([])
  const [evalResult, setEvalResult] = useState<{ expr: string; value: string } | null>(null)
  const [gdbOutput, setGdbOutput] = useState<{ cmd: string; output: string } | null>(null)
  const [sectionData, setSectionData] = useState<{ name: string; entries: { addr: number; val: number }[] } | null>(null)
  const [checksecData, setChecksecData] = useState<ChecksecResult | null>(null)
  const [vmmapData, setVmmapData] = useState<VmmapEntry[] | null>(null)
  const [gotData, setGotData] = useState<GotEntry[] | null>(null)
  const [cyclicResult, setCyclicResult] = useState<string | null>(null)
  const [cyclicFindResult, setCyclicFindResult] = useState<{ value: string; offset: number } | null>(null)
  const [ropResult, setRopResult] = useState<{ addr: string; gadget: string }[] | null>(null)
  const [stepping, setStepping] = useState(false)
  const [programExited, setProgramExited] = useState(false)
  const pendingStepAfterReset = useRef(false)
  const ws = useRef<WebSocket | null>(null)

  const send = useCallback((msg: Record<string, unknown>) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      console.log('[ASMBLE] WS send:', msg.type)
      ws.current.send(JSON.stringify(msg))
    } else {
      console.warn('[ASMBLE] WS send FAILED (not open):', msg.type, 'readyState:', ws.current?.readyState)
    }
  }, [])

  const handleMessage = useCallback((e: MessageEvent) => {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(e.data)
    } catch {
      console.error('[ASMBLE] Failed to parse WS message:', e.data)
      return
    }

    console.log('[ASMBLE] WS recv:', data.type, data)

    switch (data.type) {
      case 'session':
        setSessionId(data.id as string)
        setError(null)
        break

      case 'snapshot': {
        const snap = data.payload as StepSnapshot
        // Ensure stack entries have numeric addr/val (backend may send strings or ints)
        if (snap.stackEntries) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          snap.stackEntries = snap.stackEntries.map((e: any) => ({
            ...e,
            addr: typeof e.addr === 'string' ? parseInt(e.addr, 16) : Number(e.addr),
            val: typeof e.val === 'string' ? parseInt(e.val, 16) : Number(e.val),
          }))
        }
        // Forward inferior output to programOutput
        if (snap.inferiorOutput && snap.inferiorOutput.length > 0) {
          setProgramOutput(prev => [...prev, ...snap.inferiorOutput!])
        }
        setSnapshot(snap)
        setHistory(prev => [...prev, snap])
        setStepping(false)
        setError(null)
        setProgramExited(false)
        // Auto-step after pending reset (user clicked Next while program was exited)
        if (pendingStepAfterReset.current) {
          pendingStepAfterReset.current = false
          setTimeout(() => { setStepping(true); send({ type: 'step' }) }, 0)
        }
        break
      }

      case 'error':
        setError(`[${(data.phase as string) ?? 'unknown'}] ${data.message}`)
        setStepping(false)
        break

      case 'output':
        setProgramOutput(prev => [...prev, data.text as string])
        break

      case 'eval_result':
        setEvalResult({ expr: data.expr as string, value: data.value as string })
        break

      case 'gdb_output':
        setGdbOutput({ cmd: data.cmd as string, output: data.output as string })
        break

      case 'section_data':
        setSectionData({ name: data.name as string, entries: data.entries as { addr: number; val: number }[] })
        break

      case 'checksec':
        setChecksecData(data.payload as ChecksecResult)
        break

      case 'vmmap':
        setVmmapData(data.payload as VmmapEntry[])
        break

      case 'got':
        setGotData(data.payload as GotEntry[])
        break

      case 'cyclic':
        setCyclicResult(data.pattern as string)
        break

      case 'cyclic_find':
        setCyclicFindResult({ value: data.value as string, offset: data.offset as number })
        break

      case 'rop':
        setRopResult(data.gadgets as { addr: string; gadget: string }[])
        break

      case 'program_exit':
        setProgramOutput(prev => [...prev, `Programme terminé (code ${data.code})`])
        setProgramExited(true)
        break

      case 'assembled':
        // Session created, binary ready
        break

      default:
        console.warn('[ASMBLE] Unknown WS message type:', data.type)
    }
  }, [send])

  const connect = useCallback((code: string, flavor = 'nasm', mode: 'run' | 'assemble' = 'run') => {
    // Fermer la connexion existante (détacher les handlers pour éviter que
    // l'ancien onclose n'annule ws.current après l'assignation du nouveau socket)
    if (ws.current) {
      const old = ws.current
      old.onopen = null
      old.onmessage = null
      old.onerror = null
      old.onclose = null
      old.close()
    }

    setState('connecting')
    setError(null)
    setHistory([])
    setSnapshot(null)
    setSessionId(null)
    setProgramOutput([])
    setEvalResult(null)
    setGdbOutput(null)
    setSectionData(null)
    setChecksecData(null)
    setVmmapData(null)
    setGotData(null)
    setCyclicResult(null)
    setCyclicFindResult(null)
    setRopResult(null)
    setProgramExited(false)
    pendingStepAfterReset.current = false

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${location.host}/api/ws`)

    socket.onopen = () => {
      setState('connected')
      socket.send(JSON.stringify({ type: mode, code, flavor }))
    }

    socket.onmessage = handleMessage

    socket.onerror = () => {
      setState('error')
      setError('WebSocket connection error')
    }

    socket.onclose = () => {
      setState('disconnected')
      ws.current = null
    }

    ws.current = socket
  }, [handleMessage])

  const step = useCallback(() => {
    if (programExited) {
      // Auto-reset then step: reset creates a new session paused at _start
      pendingStepAfterReset.current = true
      setProgramExited(false)
      setHistory([])
      send({ type: 'reset' })
      return
    }
    setStepping(true)
    send({ type: 'step' })
  }, [send, programExited])
  const stepOver = useCallback(() => { setStepping(true); send({ type: 'step_over' }) }, [send])
  const stepOut = useCallback(() => { setStepping(true); send({ type: 'step_out' }) }, [send])
  const stepBack = useCallback(() => { setStepping(true); send({ type: 'step_back' }) }, [send])
  const continueExec = useCallback(() => { setStepping(true); send({ type: 'continue' }) }, [send])
  const addBreakpoint = useCallback((line: number, condition?: string) => send({ type: 'breakpoint_add', line, condition }), [send])
  const removeBreakpoint = useCallback((line: number) => send({ type: 'breakpoint_remove', line }), [send])
  const addWatchpoint = useCallback((expr: string, kind = 'write') => send({ type: 'watchpoint_add', expr, kind }), [send])
  const removeWatchpoint = useCallback((id: string) => send({ type: 'watchpoint_remove', id }), [send])
  const evaluate = useCallback((expr: string) => send({ type: 'evaluate', expr }), [send])
  const setRegister = useCallback((reg: string, value: number) => send({ type: 'set_register', reg, value }), [send])
  const setArgs = useCallback((args: string) => send({ type: 'set_args', args }), [send])
  const gdbCommand = useCallback((cmd: string) => send({ type: 'gdb_command', cmd }), [send])
  const readSection = useCallback((name: string) => send({ type: 'read_section', name }), [send])
  const requestChecksec = useCallback(() => send({ type: 'checksec' }), [send])
  const requestVmmap = useCallback(() => send({ type: 'vmmap' }), [send])
  const requestGot = useCallback(() => send({ type: 'got' }), [send])
  const requestCyclic = useCallback((length: number, n?: number) => send({ type: 'cyclic', length, ...(n !== undefined && { n }) }), [send])
  const requestCyclicFind = useCallback((value: string, n?: number) => send({ type: 'cyclic_find', value, ...(n !== undefined && { n }) }), [send])
  const requestRop = useCallback((filter?: string) => send({ type: 'rop', ...(filter && { filter }) }), [send])
  const reset = useCallback(() => {
    setHistory([])
    setProgramExited(false)
    pendingStepAfterReset.current = false
    send({ type: 'reset' })
  }, [send])

  const disconnect = useCallback(() => {
    send({ type: 'disconnect' })
    ws.current?.close()
    ws.current = null
    setState('disconnected')
    setSessionId(null)
    setSnapshot(null)
    setHistory([])
    setProgramOutput([])
    setGdbOutput(null)
    setSectionData(null)
    setChecksecData(null)
    setVmmapData(null)
    setGotData(null)
    setCyclicResult(null)
    setCyclicFindResult(null)
    setRopResult(null)
  }, [send])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      ws.current?.close()
    }
  }, [])

  return {
    state, stepping, programExited, sessionId, snapshot, error, history, programOutput, evalResult, gdbOutput, sectionData,
    checksecData, vmmapData, gotData, cyclicResult, cyclicFindResult, ropResult,
    connect, step, stepOver, stepOut, stepBack, continueExec,
    addBreakpoint, removeBreakpoint, addWatchpoint, removeWatchpoint,
    evaluate, setRegister, setArgs, gdbCommand, readSection,
    requestChecksec, requestVmmap, requestGot, requestCyclic, requestCyclicFind, requestRop,
    reset, disconnect,
  }
}
