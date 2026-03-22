import { useState, useRef, useEffect } from 'react'
import { SAMPLE_CODE, STEPS, C_PATTERNS, LEXICON_INSTRS, SYSCALLS, REG_MAIN, REG_EXT, getSubRegs, toHex16 } from './data'
import './asmble.css'

const DEFAULT_CODE = SAMPLE_CODE.map(l => '  '.repeat(l.indent) + l.label).join('\n')

function RegCard({ name, val, changed, expanded, onToggle }: {
  name: string; val: number; changed: boolean; expanded: boolean; onToggle: (n: string) => void
}) {
  const isRip = name === 'rip'
  const subs = getSubRegs(name, val)
  const cls = `asm-reg ${changed ? 'changed' : ''} ${isRip ? 'rip' : ''}`
  return (
    <div className={cls}>
      <div className="asm-reg-head" onClick={() => subs.length && onToggle(name)}>
        <div className="asm-reg-top">
          <span className="asm-reg-name">{name.toUpperCase()}</span>
          <div className="asm-reg-icons">
            {changed && <span className="asm-reg-delta">&#9650;</span>}
            {subs.length > 0 && <span className="asm-reg-arrow">{expanded ? '\u25B2' : '\u25BC'}</span>}
          </div>
        </div>
        <div className="asm-reg-hex">
          <span className="asm-hex-prefix">0x</span>
          {BigInt.asUintN(64, BigInt(val)).toString(16).padStart(16, '0')}
        </div>
        <div className="asm-reg-dec">
          = <span className="asm-reg-dec-val">{val}</span>
        </div>
      </div>
      {expanded && subs.length > 0 && (
        <div className="asm-reg-subs">
          {subs.map(s => (
            <div key={s.name} className="asm-reg-sub">
              <div className="asm-reg-sub-left">
                <span className="asm-reg-sub-bits">{s.bits}</span>
                <span className="asm-reg-sub-name">{s.name}</span>
              </div>
              <div className="asm-reg-sub-right">
                <span className="asm-reg-sub-hex">
                  <span className="asm-hex-prefix">0x</span>
                  {s.val.toString(16).padStart(s.bits === '31:0' ? 8 : s.bits.includes('15') ? 4 : 2, '0')}
                </span>
                <span className="asm-reg-sub-dec">= {s.val}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="asm-codeblock">
      {code.split('\n').map((l, i) => {
        const isComment = l.trimStart().startsWith(';') || l.trimStart().startsWith('//')
        const isLabel = l.trimEnd().endsWith(':')
        return (
          <div key={i} className={`asm-codeblock-line ${isComment ? 'comment' : ''} ${isLabel ? 'label' : ''}`}>
            {l}
          </div>
        )
      })}
    </div>
  )
}

export default function AsmDebugger() {
  const [code, setCode] = useState(DEFAULT_CODE)
  const [step, setStep] = useState(0)
  const [activeTab, setActiveTab] = useState('stack')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showExt, setShowExt] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumsRef = useRef<HTMLDivElement>(null)
  const [cPattern, setCPattern] = useState(0)
  const [lexSearch, setLexSearch] = useState('')
  const [lexTab, setLexTab] = useState<'instructions' | 'syscalls'>('instructions')

  const cur = STEPS[step]
  const prev = step > 0 ? STEPS[step - 1] : null
  const canBack = step > 0
  const canForward = step < STEPS.length - 1

  const toggleReg = (n: string) => setExpanded(e => ({ ...e, [n]: !e[n] }))

  const history = STEPS.slice(1, step + 1).map((s, i) => {
    const pv = STEPS[i]
    return {
      instr: s.instr,
      jumped: s.jumped,
      deltas: s.changed.filter(r => r !== 'rip').map(r => ({ reg: r, from: pv.regs[r], to: s.regs[r] })),
    }
  }).reverse()

  const categories = [...new Set(C_PATTERNS.map(p => p.category))]

  const filteredInstrs = LEXICON_INSTRS.filter(i =>
    i.name.toLowerCase().includes(lexSearch.toLowerCase()) ||
    i.desc.toLowerCase().includes(lexSearch.toLowerCase())
  )
  const filteredSyscalls = SYSCALLS.filter(s =>
    s.name.toLowerCase().includes(lexSearch.toLowerCase()) ||
    String(s.num).includes(lexSearch) ||
    s.desc.toLowerCase().includes(lexSearch.toLowerCase())
  )

  const TABS = ['stack', 'history', 'c\u2192asm', 'lexique']

  return (
    <div className="asm-root">
      {/* Header */}
      <div className="asm-header">
        <span className="asm-logo">
          &#9656; ASM<span className="asm-logo-accent">BLE</span>
        </span>
        <span className="asm-subtitle">x86-64 &middot; nasm &middot; interactive</span>
        <div className="asm-controls">
          <button className="asm-btn" onClick={() => setStep(0)}>&#8634; reset</button>
          <button className={`asm-btn ${canBack ? 'active' : ''}`} disabled={!canBack} onClick={() => setStep(s => s - 1)}>&larr; prev</button>
          <button className={`asm-btn primary ${canForward ? 'active' : ''}`} disabled={!canForward} onClick={() => setStep(s => s + 1)}>next &rarr;</button>
          <span className="asm-step-count">step {step + 1} / {STEPS.length}</span>
        </div>
      </div>

      {/* Annotation */}
      <div className={`asm-annotation ${cur.jumped ? 'jumped' : ''}`}>
        {cur.jumped && <span className="asm-jump-badge">&#9889; JUMP</span>}
        <span>{cur.annotation}</span>
      </div>

      {/* Body */}
      <div className="asm-body">
        {/* LEFT: Code editor */}
        <div className="asm-code-panel">
          <div className="asm-code-title">
            <span>source.asm</span>
          </div>
          <div className="asm-editor">
            <div className="asm-line-nums" ref={lineNumsRef}>
              {code.split('\n').map((_, i) => {
                const lineNum = i + 1
                const isActive = lineNum === cur.ip
                return (
                  <div key={i} className={`asm-line-num-row ${isActive ? 'active' : ''}`}>
                    <span className="asm-line-num">{lineNum}</span>
                    {isActive && <span className="asm-rip-marker">&#9664;</span>}
                  </div>
                )
              })}
            </div>
            <div className="asm-editor-wrap">
              {/* Active line highlight */}
              {code.split('\n').map((_, i) => {
                const lineNum = i + 1
                if (lineNum !== cur.ip) return null
                return <div key={i} className="asm-active-line-bg" style={{ top: `${i * 20}px` }} />
              })}
              <textarea
                ref={textareaRef}
                className="asm-textarea"
                value={code}
                onChange={e => setCode(e.target.value)}
                onScroll={() => {
                  if (lineNumsRef.current && textareaRef.current)
                    lineNumsRef.current.scrollTop = textareaRef.current.scrollTop
                }}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="asm-right-panel">
          {/* Registers */}
          <div className="asm-regs-section">
            <div className="asm-section-title">Registres</div>
            <div className="asm-regs-grid main">
              {REG_MAIN.map(r => (
                <RegCard key={r} name={r} val={cur.regs[r]} changed={cur.changed.includes(r)} expanded={!!expanded[r]} onToggle={toggleReg} />
              ))}
            </div>
            <button className="asm-ext-toggle" onClick={() => setShowExt(v => !v)}>
              <span>{showExt ? '\u25B2' : '\u25BC'}</span><span>r8 – r15</span>
            </button>
            {showExt && (
              <div className="asm-regs-grid ext">
                {REG_EXT.map(r => (
                  <RegCard key={r} name={r} val={cur.regs[r]} changed={cur.changed.includes(r)} expanded={!!expanded[r]} onToggle={toggleReg} />
                ))}
              </div>
            )}
          </div>

          {/* Flags */}
          <div className="asm-flags">
            <span className="asm-section-title">Flags</span>
            {Object.entries(cur.flags).map(([flag, val]) => (
              <div key={flag} className={`asm-flag ${val === 1 ? 'active' : ''}`}>
                {flag} <span className="asm-flag-eq">=</span> {val}
              </div>
            ))}
          </div>

          {/* Tab bar */}
          <div className="asm-tabs">
            {TABS.map(tab => (
              <button key={tab} className={`asm-tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
            ))}
          </div>

          {/* Tab content */}
          <div className="asm-tab-content">
            {activeTab === 'stack' && (
              <div className="asm-stack">
                <div className="asm-stack-spine">
                  <div className="asm-stack-arrow-up">&#9650;</div>
                  <div className="asm-stack-line" />
                  <div className="asm-stack-arrow-down">&#9660;</div>
                </div>
                <div className="asm-stack-entries">
                  {cur.stackEntries.map((entry, i) => {
                    const isRsp = entry.addr === cur.regs.rsp
                    const isRbp = entry.addr === cur.regs.rbp
                    return (
                      <div key={i} className="asm-stack-entry">
                        <span className="asm-stack-addr">{toHex16(entry.addr)}</span>
                        <span className="asm-stack-sep">&boxv;</span>
                        <span className="asm-stack-val">{toHex16(entry.val)}</span>
                        {isRsp && <span className="asm-stack-ptr">RSP</span>}
                        {isRbp && <span className="asm-stack-ptr">RBP</span>}
                      </div>
                    )
                  })}
                  <div className="asm-stack-hint">&darr; PUSH décrémente RSP</div>
                </div>
              </div>
            )}

            {activeTab === 'history' && (
              <div className="asm-history">
                {history.length === 0 && <div className="asm-empty">Aucune instruction exécutée.</div>}
                {history.map((h, i) => (
                  <div key={i} className={`asm-history-item ${i === 0 ? 'latest' : ''}`}>
                    <div className="asm-history-head">
                      <span className="asm-history-instr">{h.instr}</span>
                      {h.jumped && <span className="asm-jump-badge small">JUMP</span>}
                      {i === 0 && <span className="asm-history-latest">&larr; dernière</span>}
                    </div>
                    {h.deltas.length > 0 && (
                      <div className="asm-history-deltas">
                        {h.deltas.map(d => (
                          <div key={d.reg} className="asm-history-delta">
                            <span className="asm-delta-reg">{d.reg}</span>
                            <span className="asm-delta-from">{d.from}</span>
                            <span className="asm-delta-arrow">&rarr;</span>
                            <span className="asm-delta-to">{d.to}</span>
                            <span className="asm-delta-diff">({d.to > d.from ? '+' : ''}{d.to - d.from})</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'c\u2192asm' && (
              <div className="asm-casm">
                <div className="asm-casm-sidebar">
                  {categories.map(cat => (
                    <div key={cat}>
                      <div className="asm-casm-cat">{cat}</div>
                      {C_PATTERNS.filter(p => p.category === cat).map(p => {
                        const idx = C_PATTERNS.indexOf(p)
                        return (
                          <div key={idx} className={`asm-casm-item ${idx === cPattern ? 'active' : ''}`} onClick={() => setCPattern(idx)}>
                            {p.label}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
                <div className="asm-casm-detail">
                  {(() => {
                    const p = C_PATTERNS[cPattern]
                    return (
                      <>
                        <div className="asm-casm-title">{p.label}</div>
                        <div className="asm-section-title">C</div>
                        <CodeBlock code={p.c} />
                        <div className="asm-section-title" style={{ marginTop: '12px' }}>ASM (nasm x86-64)</div>
                        <CodeBlock code={p.asm} />
                        {p.note && <div className="asm-casm-note">{p.note}</div>}
                      </>
                    )
                  })()}
                </div>
              </div>
            )}

            {activeTab === 'lexique' && (
              <div className="asm-lexicon">
                <div className="asm-lexicon-bar">
                  <input
                    className="asm-lexicon-search"
                    value={lexSearch}
                    onChange={e => setLexSearch(e.target.value)}
                    placeholder="Rechercher instruction, syscall..."
                  />
                  {(['instructions', 'syscalls'] as const).map(t => (
                    <button key={t} className={`asm-lexicon-tab ${lexTab === t ? 'active' : ''}`} onClick={() => setLexTab(t)}>{t}</button>
                  ))}
                </div>
                <div className="asm-lexicon-content">
                  {lexTab === 'instructions' && (
                    <>
                      {[...new Set(filteredInstrs.map(i => i.cat))].map(cat => (
                        <div key={cat} className="asm-lexicon-group">
                          <div className="asm-lexicon-group-title">{cat}</div>
                          {filteredInstrs.filter(i => i.cat === cat).map(ins => (
                            <div key={ins.name} className="asm-lexicon-item">
                              <div className="asm-lexicon-item-head">
                                <span className="asm-lexicon-name">{ins.name}</span>
                                <span className="asm-lexicon-syntax">{ins.syntax}</span>
                              </div>
                              <div className="asm-lexicon-desc">{ins.desc}</div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </>
                  )}
                  {lexTab === 'syscalls' && (
                    <>
                      {filteredSyscalls.map(s => (
                        <div key={s.num} className="asm-lexicon-item">
                          <div className="asm-lexicon-item-head">
                            <span className="asm-lexicon-num">{s.num}</span>
                            <span className="asm-lexicon-sname">{s.name}</span>
                            <span className="asm-lexicon-syntax">{s.args}</span>
                          </div>
                          <div className="asm-lexicon-desc">{s.desc}</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
