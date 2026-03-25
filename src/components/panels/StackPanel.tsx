import { memo } from 'react'
import type { StepSnapshot } from '../../data/types'

interface Props {
  cur: StepSnapshot
  displayMode: 'hex' | 'dec' | 'bin'
  isLive: boolean
  watchExpr: string
  setWatchExpr: (v: string) => void
  watchpoints: { expr: string; kind: string; id: string }[]
  onAddWatchpoint: (expr: string) => void
  onRemoveWatchpoint: (idx: number, id: string) => void
}

export const StackPanel = memo(function StackPanel({
  cur, displayMode, isLive, watchExpr, setWatchExpr,
  watchpoints, onAddWatchpoint, onRemoveWatchpoint,
}: Props) {
  return (
    <div className="asm-stack">
      <div className="asm-stack-label-high">Adresses hautes</div>
      <div className="asm-stack-slots">
        {cur.stackEntries.filter(e => {
          if (e.addr < cur.regs.rsp) return false
          if (cur.regs.rbp > cur.regs.rsp) return e.addr <= cur.regs.rbp + 8
          return e.addr < cur.regs.rsp + 4 * 8
        }).map((entry, i) => {
          const isRsp = entry.addr === cur.regs.rsp
          const isRbp = entry.addr === cur.regs.rbp
          const fmtAddr = '0x' + entry.addr.toString(16)
          const bVal = BigInt.asUintN(64, BigInt(entry.val))
          const fmtVal = displayMode === 'bin'
            ? '0b' + bVal.toString(2)
            : displayMode === 'hex'
              ? '0x' + (entry.val === 0 ? '0' : bVal.toString(16))
              : String(entry.val)
          const valTip = `hex: 0x${bVal.toString(16)}\ndec: ${entry.val}\nbin: 0b${bVal.toString(2)}`
          return (
            <div key={i} className={`asm-stack-slot ${isRsp ? 'rsp' : ''} ${isRbp ? 'rbp' : ''}`}>
              <span className="asm-stack-slot-addr">{fmtAddr}</span>
              <span className="asm-stack-slot-val" title={valTip}>{fmtVal}</span>
              <div className="asm-stack-slot-tags">
                {isRsp && <span className="asm-stack-tag rsp-tag">RSP ▼</span>}
                {isRbp && !isRsp && <span className="asm-stack-tag rbp-tag">RBP</span>}
                {isRsp && isRbp && <span className="asm-stack-tag rbp-tag">RBP</span>}
              </div>
              {entry.label && <span className="asm-stack-slot-label">{entry.label}</span>}
            </div>
          )
        })}
      </div>
      <div className="asm-stack-footer">
        <span className="asm-stack-grow">▼ PUSH décrémente RSP</span>
      </div>

      {/* Backtrace */}
      {cur.backtrace && cur.backtrace.length > 0 && (
        <div className="asm-backtrace">
          <div className="asm-section-title">Backtrace</div>
          {cur.backtrace.map((f, i) => (
            <div key={i} className={`asm-bt-frame ${i === 0 ? 'active' : ''}`}>
              <span className="asm-bt-level">#{f.level}</span>
              <span className="asm-bt-func">{f.func}</span>
              <span className="asm-bt-addr">0x{f.addr.toString(16)}</span>
              {f.file && <span className="asm-bt-file">{f.file}:{f.line}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Watchpoints */}
      {isLive && (
        <div className="asm-watchpoints">
          <div className="asm-section-title">Watchpoints</div>
          <div className="asm-wp-add">
            <input
              className="asm-wp-input"
              value={watchExpr}
              onChange={e => setWatchExpr(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && watchExpr.trim()) {
                  onAddWatchpoint(watchExpr.trim())
                }
              }}
              placeholder="$rax, *0x404000..."
            />
            <button className="asm-btn" onClick={() => {
              if (watchExpr.trim()) onAddWatchpoint(watchExpr.trim())
            }}>Watch</button>
          </div>
          {watchpoints.map((wp, i) => (
            <div key={i} className="asm-wp-entry">
              <span className="asm-wp-expr">{wp.expr}</span>
              <span className="asm-wp-kind">{wp.kind}</span>
              <button className="asm-wp-remove" onClick={() => onRemoveWatchpoint(i, wp.id)}>&times;</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
