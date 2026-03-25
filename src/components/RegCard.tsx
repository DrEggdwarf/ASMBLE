import { memo } from 'react'
import { getSubRegs } from '../data'

const SEG_COLORS = ['#ff9e64', '#7dcfff', '#bb9af7', '#73daca']

function Sparkline({ values, width = 60, height = 16 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - 1 - ((v - min) / range) * (height - 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg className="asm-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={pts.join(' ')} fill="none" stroke="#3fb950" strokeWidth="1.2" />
      <circle cx={pts[pts.length - 1].split(',')[0]} cy={pts[pts.length - 1].split(',')[1]} r="1.5" fill="#3fb950" />
    </svg>
  )
}

export const RegCard = memo(function RegCard({ name, val, prevVal, changed, showUpper, displayMode, history }: {
  name: string; val: number; prevVal: number | null; changed: boolean; showUpper: boolean; displayMode: 'hex' | 'dec' | 'bin'; history?: number[]
}) {
  const fmtMain = (v: number) => {
    if (displayMode === 'bin') return '0b' + BigInt.asUintN(64, BigInt(v)).toString(2)
    return displayMode === 'hex'
      ? '0x' + (v === 0 ? '0' : BigInt.asUintN(64, BigInt(v)).toString(16))
      : String(v)
  }
const fmtTooltip = (v: number) => {
    const b = BigInt.asUintN(64, BigInt(v))
    return `hex: 0x${b.toString(16)}\ndec: ${v}\nbin: 0b${b.toString(2)}`
  }
  const subs = getSubRegs(name, val)

  // Upper 32 bits value (bits 63:32)
  const hi32 = Number(BigInt.asUintN(64, BigInt(val)) >> 32n)

  type Seg = { name: string; val: number; pct: number; ci: number }
  const segs: Seg[] = []
  const scale = showUpper ? 1 : 2
  if (showUpper) segs.push({ name: '63:32', val: hi32, pct: 50, ci: -1 })

  if (subs.length >= 2) {
    const v31_16 = (subs[0].val >>> 16) & 0xFFFF
    segs.push({ name: subs[0].name, val: v31_16, pct: 25 * scale, ci: 0 })
  }
  if (subs.length === 4) {
    segs.push({ name: subs[2].name, val: subs[2].val, pct: 12.5 * scale, ci: 2 })
    segs.push({ name: subs[3].name, val: subs[3].val, pct: 12.5 * scale, ci: 3 })
  } else if (subs.length === 3) {
    const v15_8 = (subs[1].val >>> 8) & 0xFF
    segs.push({ name: subs[1].name, val: v15_8, pct: 12.5 * scale, ci: 1 })
    segs.push({ name: subs[2].name, val: subs[2].val, pct: 12.5 * scale, ci: 3 })
  }

  const fmtVal = (v: number) => {
    if (displayMode === 'bin') return v.toString(2)
    return displayMode === 'hex' ? (v === 0 ? '0' : '0x' + v.toString(16)) : String(v)
  }

  return (
    <div className={`asm-regcard ${changed ? 'changed' : ''}`}>
      <div className="asm-regcard-head">
        <span className="asm-regcard-pill">{name}</span>
        <span className="asm-regcard-val" title={fmtTooltip(val)}>{fmtMain(val)}</span>
        {history && history.length >= 2 && <Sparkline values={history} />}
        {changed && prevVal !== null && (
          <span className="asm-regcard-delta">
            <span className="asm-delta-old">{fmtMain(prevVal)}</span>
            <span className="asm-delta-arrow">&rarr;</span>
            <span className="asm-delta-new">{fmtMain(val)}</span>
            <span className="asm-delta-diff">{(() => {
              const d = BigInt(val) - BigInt(prevVal)
              return d >= 0n ? `+${d}` : String(d)
            })()}</span>
          </span>
        )}
      </div>
      <div className="asm-regcard-bar">
        {segs.map((seg, i) => (
          <div
            key={i}
            className={`asm-regbar-seg ${seg.val !== 0 ? 'active' : ''} ${seg.ci === -1 ? 'upper' : ''}`}
            style={seg.ci >= 0 ? { width: seg.pct + '%', backgroundColor: SEG_COLORS[seg.ci] + (seg.val !== 0 ? '' : '20') } : { width: seg.pct + '%' }}
            title={`${seg.name} = ${seg.val} (0x${seg.val.toString(16)})`}
          >
            <span className="asm-seg-pill">{seg.name}</span>
            <span className="asm-seg-val">{fmtVal(seg.val)}</span>
          </div>
        ))}
      </div>
    </div>
  )
})

export const RegExtRow = memo(function RegExtRow({ name, val, prevVal, changed, displayMode, history }: { name: string; val: number; prevVal: number | null; changed: boolean; displayMode: 'hex' | 'dec' | 'bin'; history?: number[] }) {
  const display = displayMode === 'bin'
    ? '0b' + BigInt.asUintN(64, BigInt(val)).toString(2)
    : displayMode === 'hex'
      ? '0x' + (val === 0 ? '0' : BigInt.asUintN(64, BigInt(val)).toString(16))
      : String(val)
  const tip = `hex: 0x${BigInt.asUintN(64, BigInt(val)).toString(16)}\ndec: ${val}\nbin: 0b${BigInt.asUintN(64, BigInt(val)).toString(2)}`
  return (
    <div className={`asm-regext ${changed ? 'changed' : ''}`}>
      <span className="asm-regext-name">{name}</span>
      <span className="asm-regext-val" title={tip}>{display}</span>
      {history && history.length >= 2 && <Sparkline values={history} width={40} height={12} />}
      {changed && prevVal !== null && (
        <span className="asm-regext-delta">{(() => {
          const d = BigInt(val) - BigInt(prevVal)
          return d >= 0n ? `+${d}` : String(d)
        })()}</span>
      )}
    </div>
  )
})
