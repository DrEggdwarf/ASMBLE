import { memo, useState, useMemo, useEffect, useCallback, type ReactNode } from 'react'
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
      {safe ? <i className="fa-solid fa-check" /> : <i className="fa-solid fa-xmark" />} {label}
    </span>
  )
}

function ToolCard({ icon, label, desc, badge, hasData, wip, color, onClick }: {
  icon: string
  label: string
  desc: string
  badge?: string | null
  hasData?: boolean
  wip?: boolean
  color: string
  onClick: () => void
}) {
  return (
    <button
      className={`asm-tool-card ${hasData ? 'has-data' : ''} ${wip ? 'wip' : ''}`}
      onClick={wip ? undefined : onClick}
      title={wip ? `${label} — bientôt disponible` : label}
      disabled={wip}
    >
      <div className="asm-tool-card-icon-wrap" style={{ '--card-color': color } as React.CSSProperties}>
        <i className={icon} />
      </div>
      <div className="asm-tool-card-label">{label}</div>
      <div className="asm-tool-card-sub">{desc}</div>
      {wip && <div className="asm-tool-card-wip">WiP</div>}
      {!wip && badge && <div className="asm-tool-card-badge">{badge}</div>}
    </button>
  )
}

function ToolModal({ title, icon, onClose, actions, children }: {
  title: string
  icon: string
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="asm-tool-modal-overlay" onMouseDown={onClose}>
      <div className="asm-tool-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="asm-tool-modal-header">
          <i className={`${icon} asm-tool-modal-icon`} />
          <span className="asm-tool-modal-title">{title}</span>
          {actions && <div className="asm-tool-modal-actions">{actions}</div>}
          <button className="asm-tool-modal-close" onClick={onClose} title="Fermer (Échap)">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="asm-tool-modal-body">{children}</div>
      </div>
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
  const [activeModal, setActiveModal] = useState<string | null>(null)
  const close = useCallback(() => setActiveModal(null), [])

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

      {/* ── Checksec — toujours visible en haut ── */}
      <div className="asm-checksec-inline">
        <div className="asm-checksec-inline-header">
          <i className="fa-solid fa-shield-halved" />
          <span>Checksec</span>
          {connected && (
            <button className="asm-btn asm-btn-xs" onClick={onRequestChecksec} style={{ marginLeft: 'auto' }}>
              {checksec ? 'Actualiser' : 'Analyser'}
            </button>
          )}
        </div>
        {checksec ? (
          <div className="asm-sec-badges">
            <Badge label={`RELRO: ${checksec.relro}`} safe={checksec.relro === 'Full'} />
            <Badge label="Canary" safe={checksec.canary} />
            <Badge label="NX" safe={checksec.nx} />
            <Badge label="PIE" safe={checksec.pie} />
            <Badge label="RPATH" safe={!checksec.rpath} />
            <Badge label="RUNPATH" safe={!checksec.runpath} />
            <Badge label="Fortify" safe={checksec.fortify} />
            <Badge label={checksec.stripped ? 'Stripped' : 'Symbols'} safe={!checksec.stripped} />
          </div>
        ) : (
          <div className="asm-empty">Assemblez puis cliquez Analyser.</div>
        )}
      </div>

      {/* ── Grille de tools ── */}
      <div className="asm-tool-grid">
        <ToolCard
          icon="fa-solid fa-map"
          label="VMmap"
          desc="Mapping mémoire"
          color="#388bfd"
          hasData={!!vmmap}
          badge={vmmap ? `${vmmap.length} régions` : null}
          onClick={() => {
            if (connected && !vmmap) onRequestVmmap()
            setActiveModal('vmmap')
          }}
        />
        <ToolCard
          icon="fa-solid fa-table-list"
          label="GOT"
          desc="Global Offset Table"
          color="#bb9af7"
          hasData={!!got}
          badge={got ? `${got.length} entrées` : null}
          onClick={() => {
            if (connected && !got) onRequestGot()
            setActiveModal('got')
          }}
        />
        <ToolCard
          icon="fa-solid fa-ruler-horizontal"
          label="Cyclic"
          desc="Pattern De Bruijn"
          color="#ff9e64"
          hasData={!!cyclicResult}
          badge={cyclicResult ? 'Généré' : null}
          onClick={() => setActiveModal('cyclic')}
        />
        <ToolCard
          icon="fa-solid fa-link-slash"
          label="ROP"
          desc="Gadgets ROP"
          color="#f85149"
          hasData={!!ropResult}
          badge={ropResult ? `${ropResult.length} gadgets` : null}
          onClick={() => setActiveModal('rop')}
        />
        <ToolCard
          icon="fa-solid fa-binoculars"
          label="Telescope"
          desc="Déréférencement ptr"
          color="#2ea9a9"
          wip
          onClick={() => {}}
        />
        <ToolCard
          icon="fa-solid fa-magnifying-glass"
          label="Search"
          desc="Recherche mémoire"
          color="#e3b341"
          wip
          onClick={() => {}}
        />
        <ToolCard
          icon="fa-solid fa-circle-nodes"
          label="Heap"
          desc="Visualiseur heap"
          color="#3fb950"
          wip
          onClick={() => {}}
        />
        <ToolCard
          icon="fa-solid fa-memory"
          label="Hexdump"
          desc="Dump hexadécimal"
          color="#79c0ff"
          wip
          onClick={() => {}}
        />
        <ToolCard
          icon="fa-solid fa-egg"
          label="Canary"
          desc="Stack canary"
          color="#bc8cff"
          wip
          onClick={() => {}}
        />
        <ToolCard
          icon="fa-solid fa-font"
          label="Strings"
          desc="Chaînes ASCII"
          color="#f97583"
          wip
          onClick={() => {}}
        />
      </div>

      {/* ── Modal VMmap ── */}
      {activeModal === 'vmmap' && (
        <ToolModal
          title="VMmap — Mapping mémoire"
          icon="fa-solid fa-map"
          onClose={close}
          actions={connected ? <button className="asm-btn asm-btn-xs" onClick={onRequestVmmap}>Actualiser</button> : undefined}
        >
          {vmmap && vmmap.length > 0 ? (
            <div className="asm-sec-table-wrap">
              <table className="asm-sec-table">
                <thead>
                  <tr><th>Start</th><th>End</th><th>Perms</th><th>Path</th></tr>
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
        </ToolModal>
      )}

      {/* ── Modal GOT ── */}
      {activeModal === 'got' && (
        <ToolModal
          title="GOT — Global Offset Table"
          icon="fa-solid fa-table-list"
          onClose={close}
          actions={connected ? <button className="asm-btn asm-btn-xs" onClick={onRequestGot}>Actualiser</button> : undefined}
        >
          {got && got.length > 0 ? (
            <div className="asm-sec-table-wrap">
              <table className="asm-sec-table">
                <thead>
                  <tr><th>Symbol</th><th>Address</th><th>Type</th><th>Value</th></tr>
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
            <div className="asm-empty">{got ? 'Pas d\'entrées GOT (binaire statique).' : 'Cliquez Actualiser après assemblage.'}</div>
          )}
        </ToolModal>
      )}

      {/* ── Modal Cyclic ── */}
      {activeModal === 'cyclic' && (
        <ToolModal
          title="Cyclic — Pattern De Bruijn"
          icon="fa-solid fa-ruler-horizontal"
          onClose={close}
        >
          <div className="asm-exploit-sub" style={{ borderTop: 'none', paddingTop: 0 }}>
            <span className="asm-exploit-label">Générer un pattern</span>
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

          <div className="asm-exploit-sub">
            <span className="asm-exploit-label">Trouver un offset</span>
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
        </ToolModal>
      )}

      {/* ── Modal ROP ── */}
      {activeModal === 'rop' && (
        <ToolModal
          title="ROP — Gadgets ROP"
          icon="fa-solid fa-link-slash"
          onClose={close}
        >
          <div className="asm-exploit-sub" style={{ borderTop: 'none', paddingTop: 0 }}>
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
                <div className="asm-sec-table-wrap" style={{ maxHeight: '50vh' }}>
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
        </ToolModal>
      )}

    </div>
  )
})
