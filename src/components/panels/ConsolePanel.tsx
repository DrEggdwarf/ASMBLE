import { memo } from 'react'

interface Props {
  isLive: boolean
  connected: boolean
  gdbCmdInput: string
  setGdbCmdInput: (v: string) => void
  gdbConsoleHistory: { cmd: string; output: string }[]
  setGdbConsoleHistory: React.Dispatch<React.SetStateAction<{ cmd: string; output: string }[]>>
  onGdbCommand: (cmd: string) => void
}

export const ConsolePanel = memo(function ConsolePanel({
  isLive, connected, gdbCmdInput, setGdbCmdInput,
  gdbConsoleHistory, setGdbConsoleHistory, onGdbCommand,
}: Props) {
  const submitCmd = () => {
    const cmd = gdbCmdInput.trim()
    if (!cmd) return
    if (isLive && connected) {
      onGdbCommand(cmd)
    } else {
      setGdbConsoleHistory(prev => [...prev, { cmd, output: '(non connecté — mode local)' }])
    }
    setGdbCmdInput('')
  }

  return (
    <div className="asm-gdb-console">
      <div className="asm-gdb-console-bar">
        <span className="asm-gdb-prompt">(gdb)</span>
        <input
          className="asm-gdb-input"
          value={gdbCmdInput}
          onChange={e => setGdbCmdInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitCmd() }}
          placeholder="info registers, x/10x $rsp, disas..."
        />
        <button className="asm-btn" disabled={!gdbCmdInput.trim()} onClick={submitCmd}>Run</button>
        {gdbConsoleHistory.length > 0 && (
          <button className="asm-btn" onClick={() => setGdbConsoleHistory([])}>Clear</button>
        )}
      </div>
      <div className="asm-gdb-console-output">
        {gdbConsoleHistory.map((r, i) => (
          <div key={i} className="asm-gdb-entry">
            <div className="asm-gdb-cmd">(gdb) {r.cmd}</div>
            <pre className="asm-gdb-result">{r.output}</pre>
          </div>
        ))}
        {gdbConsoleHistory.length === 0 && (
          <div className="asm-eval-hint">
            Console GDB directe. Commandes utiles :<br/>
            <strong>info registers</strong> — tous les registres<br/>
            <strong>x/10x $rsp</strong> — examiner la mémoire<br/>
            <strong>disas</strong> — désassembler la fonction<br/>
            <strong>info breakpoints</strong> — lister les breakpoints<br/>
            <strong>bt</strong> — backtrace<br/>
            <strong>print $rax</strong> — afficher un registre
          </div>
        )}
      </div>
    </div>
  )
})
