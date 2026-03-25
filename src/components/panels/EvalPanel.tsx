import { memo } from 'react'
import type { StepSnapshot } from '../../data/types'

interface Props {
  isLive: boolean
  connected: boolean
  evalExpr: string
  setEvalExpr: (v: string) => void
  evalHistory: { expr: string; value: string }[]
  setEvalHistory: React.Dispatch<React.SetStateAction<{ expr: string; value: string }[]>>
  onEvaluate: (expr: string) => void
  onLocalEval: (expr: string) => string
  cur: StepSnapshot
}

export const EvalPanel = memo(function EvalPanel({
  isLive, connected, evalExpr, setEvalExpr,
  evalHistory, setEvalHistory, onEvaluate, onLocalEval, cur,
}: Props) {
  const submitExpr = () => {
    const expr = evalExpr.trim()
    if (!expr) return
    if (isLive && connected) {
      onEvaluate(expr)
    } else {
      const result = onLocalEval(expr)
      setEvalHistory(prev => [...prev, { expr, value: result }])
    }
    setEvalExpr('')
  }

  return (
    <div className="asm-eval-view">
      <div className="asm-eval-bar">
        <input
          className="asm-eval-input"
          value={evalExpr}
          onChange={e => setEvalExpr(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitExpr() }}
          placeholder="$rax, $rsp, $rax+$rbx, $rax-$rdx, flags..."
        />
        <button className="asm-btn" disabled={!evalExpr.trim()} onClick={submitExpr}>Eval</button>
        {evalHistory.length > 0 && (
          <button className="asm-btn" onClick={() => setEvalHistory([])}>Clear</button>
        )}
      </div>
      <div className="asm-eval-results">
        {evalHistory.map((r, i) => (
          <div key={i} className="asm-eval-entry">
            <span className="asm-eval-expr">{r.expr}</span>
            <span className="asm-eval-value">{r.value}</span>
          </div>
        ))}
        {evalHistory.length === 0 && (
          <div className="asm-eval-hint">
            Évalue des expressions depuis les registres du step courant.<br/>
            <strong>Registres :</strong> $rax, $rsp, $r12, rax<br/>
            <strong>Arithmétique :</strong> $rax+$rbx, $rsp-8, $r12*2<br/>
            <strong>Formats :</strong> hex($rax), bin($rax), dec($rax)<br/>
            <strong>Spécial :</strong> flags, stack, regs
            {isLive && <><br/><strong>Live :</strong> expressions GDB complètes via le backend</>}
          </div>
        )}
      </div>
    </div>
  )
})
