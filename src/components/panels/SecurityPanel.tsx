import { memo, useState, useMemo, type ReactNode } from 'react'
import type { ChecksecResult, VmmapEntry, GotEntry } from '../../data/types'

interface Props {
  checksec: ChecksecResult | null
  vmmap: VmmapEntry[] | null
  got: GotEntry[] | null
  cyclicResult: string | null
  cyclicFindResult: { value: string; offset: number } | null
  ropResult: { addr: string; gadget: string }[] | null
  connected: boolean
  onRequestChecksec: () => void
  onRequestVmmap: () => void
  onRequestGot: () => void
  onRequestCyclic: (length: number, n?: number) => void
  onRequestCyclicFind: (value: string, n?: number) => void
  onRequestRop: (filter?: string) => void
}

function Badge({ label, safe }: { label: string; safe: boolean }) {
  return (
    <span className={`asm-sec-badge ${safe ? 'safe' : 'unsafe'}`}>
      {safe ? '\u2714' : '\u2716'} {label}
    </span>
  )
}

function SecBlock({ title, collapsed, onToggle, actions, children }: {
  title: string
  collapsed: boolean
  onToggle: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={`asm-sec-block ${collapsed ? 'collapsed' : ''}`}>
      <div className="asm-sec-block-header" onClick={onToggle}>
        <span className="asm-sec-block-arrow">{collapsed ? '\u25B6' : '\u25BC'}</span>
        <span className="asm-section-title">{title}</span>
        {actions && <div className="asm-sec-block-actions" onClick={e => e.stopPropagation()}>{actions}</div>}
      </div>
      {!collapsed && <div className="asm-sec-block-body">{children}</div>}
    </div>
  )
}

// Highlight colors for cyclic pattern matches
const HIGHLIGHT_COLORS = [
  '#f97583', '#d2a8ff', '#79c0ff', '#56d364', '#e3b341',
  '#ff7b72', '#a5d6ff', '#7ee787', '#ffa657', '#bc8cff',
]

/** Resolve the needle string that was actually searched in the cyclic pattern */
function resolveNeedle(value: string, n: number = 4): string | null {
  const v = value.trim()
  if (v.startsWith('0x') || v.startsWith('0X')) {
    try {
      const intVal = parseInt(v, 16)
      // Convert to little-endian bytes
      const bytes: number[] = []
      let val = intVal
      for (let i = 0; i < n; i++) {
        bytes.push(val & 0xff)
        val = Math.floor(val / 256)
      }
      return String.fromCharCode(...bytes)
    } catch { return null }
  }
  if (v.length <= n) return v
  return null
}

export const SecurityPanel = memo(function SecurityPanel({
  checksec, vmmap, got, cyclicResult, cyclicFindResult, ropResult,
  connected,
  onRequestChecksec, onRequestVmmap, onRequestGot,
  onRequestCyclic, onRequestCyclicFind, onRequestRop,
}: Props) {
  const [cyclicLen, setCyclicLen] = useState('200')
  const [cyclicFindVal, setCyclicFindVal] = useState('')
  const [ropFilter, setRopFilter] = useState('')
  const [colChecksec, setColChecksec] = useState(false)
  const [colVmmap, setColVmmap] = useState(true)
  const [colGot, setColGot] = useState(true)
  const [colExploit, setColExploit] = useState(false)

  // Build highlighted cyclic output
  const cyclicHighlighted = useMemo(() => {
    if (!cyclicResult) return null
    if (!cyclicFindResult || cyclicFindResult.offset < 0) return cyclicResult

    const needle = resolveNeedle(cyclicFindResult.value)
    if (!needle || needle.length === 0) return cyclicResult

    // Find ALL occurrences of the needle in the pattern
    const matches: number[] = []
    let searchFrom = 0
    while (searchFrom <= cyclicResult.length - needle.length) {
      const idx = cyclicResult.indexOf(needle, searchFrom)
      if (idx === -1) break
      matches.push(idx)
      searchFrom = idx + 1
    }
    if (matches.length === 0) return cyclicResult

    // Build React elements with highlighted spans
    const parts: ReactNode[] = []
    let cursor = 0
    matches.forEach((start, i) => {
      if (start > cursor) {
        parts.push(cyclicResult.slice(cursor, start))
      }
      const color = HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length]
      const isMainMatch = start === cyclicFindResult.offset
      parts.push(
        <span
          key={i}
          className={`asm-cyclic-hl${isMainMatch ? ' main' : ''}`}
          style={{ backgroundColor: color + '40', borderColor: color, color }}
          title={`offset ${start}`}
        >
          {cyclicResult.slice(start, start + needle.length)}
        </span>
      )
      cursor = start + needle.length
    })
    if (cursor < cyclicResult.length) {
      parts.push(cyclicResult.slice(cursor))
    }
    return parts
  }, [cyclicResult, cyclicFindResult])

  return (
    <div className="asm-security">
      {/* Checksec */}
      <SecBlock
        title="Checksec"
        collapsed={colChecksec}
        onToggle={() => setColChecksec(v => !v)}
        actions={connected && !checksec ? <button className="asm-btn" onClick={onRequestChecksec}>Analyser</button> : undefined}
      >
        {checksec ? (
          <div className="asm-sec-badges">
            <Badge label={`RELRO: ${checksec.relro}`} safe={checksec.relro === 'Full'} />
            <Badge label="Stack Canary" safe={checksec.canary} />
            <Badge label="NX (No-Exec)" safe={checksec.nx} />
            <Badge label="PIE" safe={checksec.pie} />
            <Badge label="RPATH" safe={!checksec.rpath} />
            <Badge label="RUNPATH" safe={!checksec.runpath} />
            <Badge label="Fortify" safe={checksec.fortify} />
            <Badge label={checksec.stripped ? 'Stripped' : 'Not stripped'} safe={!checksec.stripped} />
          </div>
        ) : (
          <div className="asm-empty">Lancez une session puis cliquez Analyser.</div>
        )}
      </SecBlock>

      {/* VMmap */}
      <SecBlock
        title="VMmap"
        collapsed={colVmmap}
        onToggle={() => setColVmmap(v => !v)}
        actions={connected ? <button className="asm-btn" onClick={onRequestVmmap}>Charger</button> : undefined}
      >
        {vmmap && vmmap.length > 0 ? (
          <div className="asm-sec-table-wrap">
            <table className="asm-sec-table">
              <thead>
                <tr>
                  <th>Start</th>
                  <th>End</th>
                  <th>Perms</th>
                  <th>Path</th>
                </tr>
              </thead>
              <tbody>
                {vmmap.map((row, i) => (
                  <tr key={i} className={row.perms.includes('x') ? 'exec' : ''}>
                    <td className="mono">{row.start}</td>
                    <td className="mono">{row.end}</td>
                    <td className={`mono perms ${row.perms.includes('w') && row.perms.includes('x') ? 'wx-danger' : ''}`}>{row.perms}</td>
                    <td className="path">{row.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="asm-empty">{vmmap ? 'Aucune entrée.' : 'Démarrez le programme pour voir le mapping.'}</div>
        )}
      </SecBlock>

      {/* GOT */}
      <SecBlock
        title="GOT (Global Offset Table)"
        collapsed={colGot}
        onToggle={() => setColGot(v => !v)}
        actions={connected ? <button className="asm-btn" onClick={onRequestGot}>Charger</button> : undefined}
      >
        {got && got.length > 0 ? (
          <div className="asm-sec-table-wrap">
            <table className="asm-sec-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Address</th>
                  <th>Type</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {got.map((entry, i) => (
                  <tr key={i}>
                    <td className="sym">{entry.name}</td>
                    <td className="mono">{entry.addr}</td>
                    <td>{entry.type}</td>
                    <td className="mono">{entry.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="asm-empty">{got ? 'Pas d\'entrées GOT (binaire statique).' : 'Cliquez Charger après assemblage.'}</div>
        )}
      </SecBlock>

      {/* Exploit Tools */}
      <SecBlock
        title="Exploit Tools"
        collapsed={colExploit}
        onToggle={() => setColExploit(v => !v)}
      >
        {/* Cyclic pattern */}
        <div className="asm-exploit-sub">
          <span className="asm-exploit-label">Cyclic pattern</span>
          <div className="asm-exploit-row">
            <input
              className="asm-input asm-input-sm"
              type="number"
              min={1}
              max={65536}
              value={cyclicLen}
              onChange={e => setCyclicLen(e.target.value)}
              placeholder="Longueur"
            />
            <button className="asm-btn" onClick={() => {
              const n = parseInt(cyclicLen, 10)
              if (n > 0 && n <= 65536) onRequestCyclic(n)
            }}>Générer</button>
          </div>
          {cyclicResult !== null && (
            <pre className="asm-exploit-output">{cyclicHighlighted}</pre>
          )}
        </div>

        {/* Cyclic find */}
        <div className="asm-exploit-sub">
          <span className="asm-exploit-label">Cyclic find (offset)</span>
          <div className="asm-exploit-row">
            <input
              className="asm-input asm-input-sm"
              type="text"
              value={cyclicFindVal}
              onChange={e => setCyclicFindVal(e.target.value)}
              placeholder="0x61616162 ou aaab"
            />
            <button className="asm-btn" onClick={() => {
              if (cyclicFindVal.trim()) onRequestCyclicFind(cyclicFindVal.trim())
            }}>Trouver</button>
          </div>
          {cyclicFindResult !== null && (
            <div className={`asm-exploit-result ${cyclicFindResult.offset < 0 ? 'not-found' : ''}`}>
              {cyclicFindResult.offset >= 0
                ? <>Offset : <strong>{cyclicFindResult.offset}</strong> pour <code>{cyclicFindResult.value}</code></>
                : <>Pattern non trouvé pour <code>{cyclicFindResult.value}</code></>
              }
            </div>
          )}
        </div>

        {/* ROP gadgets */}
        <div className="asm-exploit-sub">
          <span className="asm-exploit-label">ROP Gadgets</span>
          <div className="asm-exploit-row">
            <input
              className="asm-input asm-input-sm"
              type="text"
              value={ropFilter}
              onChange={e => setRopFilter(e.target.value)}
              placeholder="Filtre (pop rdi, ret...)"
            />
            <button className="asm-btn" disabled={!connected} onClick={() => onRequestRop(ropFilter || undefined)}>
              Chercher
            </button>
          </div>
          {ropResult !== null && (
            ropResult.length > 0 ? (
              <div className="asm-sec-table-wrap">
                <table className="asm-sec-table">
                  <thead>
                    <tr><th>Address</th><th>Gadget</th></tr>
                  </thead>
                  <tbody>
                    {ropResult.map((g, i) => (
                      <tr key={i}>
                        <td className="mono">{g.addr}</td>
                        <td className="mono">{g.gadget}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="asm-empty">Aucun gadget trouvé.</div>
            )
          )}
        </div>
      </SecBlock>
    </div>
  )
})
