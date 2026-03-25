import { memo, useMemo } from 'react'
import { LEXICON_INSTRS, SYSCALLS, CALLING_CONVENTION, ADDRESSING_MODES } from '../data'

interface Props {
  open: boolean
  onClose: () => void
  refSubTab: 'lexique' | 'convention' | 'adressage'
  setRefSubTab: (v: 'lexique' | 'convention' | 'adressage') => void
  lexSearch: string
  setLexSearch: (v: string) => void
  lexTab: 'instructions' | 'syscalls'
  setLexTab: (v: 'instructions' | 'syscalls') => void
}

export const ReferenceModal = memo(function ReferenceModal({
  open, onClose, refSubTab, setRefSubTab,
  lexSearch, setLexSearch, lexTab, setLexTab,
}: Props) {
  const filteredInstrs = useMemo(() => LEXICON_INSTRS.filter(i =>
    i.name.toLowerCase().includes(lexSearch.toLowerCase()) ||
    i.desc.toLowerCase().includes(lexSearch.toLowerCase())
  ), [lexSearch])

  const filteredSyscalls = useMemo(() => SYSCALLS.filter(s =>
    s.name.toLowerCase().includes(lexSearch.toLowerCase()) ||
    String(s.num).includes(lexSearch) ||
    s.desc.toLowerCase().includes(lexSearch.toLowerCase())
  ), [lexSearch])

  if (!open) return null

  return (
    <div className="asm-modal-overlay" onClick={onClose}>
      <div className="asm-modal" onClick={e => e.stopPropagation()}>
        <div className="asm-modal-header">
          <span className="asm-modal-title">Référence x86-64</span>
          <button className="asm-modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="asm-ref-tabs">
          {(['lexique', 'convention', 'adressage'] as const).map(t => (
            <button key={t} className={`asm-ref-tab ${refSubTab === t ? 'active' : ''}`} onClick={() => setRefSubTab(t)}>{t}</button>
          ))}
        </div>
        <div className="asm-modal-body">
          {refSubTab === 'lexique' && (
            <div className="asm-lexicon">
              <div className="asm-lexicon-bar">
                <input
                  className="asm-lexicon-search"
                  value={lexSearch}
                  onChange={e => setLexSearch(e.target.value)}
                  placeholder="Rechercher instruction, syscall..."
                  autoFocus
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

          {refSubTab === 'convention' && (
            <div className="asm-convention">
              <div className="asm-conv-title">{CALLING_CONVENTION.title}</div>
              <div className="asm-conv-section">
                <div className="asm-conv-subtitle">Arguments de fonction</div>
                <div className="asm-conv-table">
                  {CALLING_CONVENTION.args.map(a => (
                    <div key={a.reg} className="asm-conv-row">
                      <span className="asm-conv-reg">{a.reg}</span>
                      <span className="asm-conv-role">{a.role}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="asm-conv-section">
                <div className="asm-conv-subtitle">Retour</div>
                <div className="asm-conv-row">
                  <span className="asm-conv-reg">{CALLING_CONVENTION.ret.reg}</span>
                  <span className="asm-conv-role">{CALLING_CONVENTION.ret.role}</span>
                </div>
              </div>
              <div className="asm-conv-section">
                <div className="asm-conv-subtitle">Syscall (Linux x86-64)</div>
                <div className="asm-conv-table">
                  {CALLING_CONVENTION.syscallArgs.map(a => (
                    <div key={a.reg} className="asm-conv-row">
                      <span className="asm-conv-reg">{a.reg}</span>
                      <span className="asm-conv-role">{a.role}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="asm-conv-section">
                <div className="asm-conv-subtitle">Caller-saved (volatils)</div>
                <div className="asm-conv-regs-list">{CALLING_CONVENTION.callerSaved.map(r => <span key={r} className="asm-conv-reg-pill caller">{r}</span>)}</div>
              </div>
              <div className="asm-conv-section">
                <div className="asm-conv-subtitle">Callee-saved (non-volatils)</div>
                <div className="asm-conv-regs-list">{CALLING_CONVENTION.calleeSaved.map(r => <span key={r} className="asm-conv-reg-pill callee">{r}</span>)}</div>
              </div>
              <div className="asm-conv-notes">
                {CALLING_CONVENTION.notes.map((n, i) => <div key={i} className="asm-conv-note">{n}</div>)}
              </div>
            </div>
          )}

          {refSubTab === 'adressage' && (
            <div className="asm-addressing">
              <div className="asm-addr-title">Modes d'adressage x86-64</div>
              {ADDRESSING_MODES.map((m, i) => (
                <div key={i} className="asm-addr-item">
                  <div className="asm-addr-head">
                    <span className="asm-addr-mode">{m.mode}</span>
                    <span className="asm-addr-formula">{m.formula}</span>
                  </div>
                  <div className="asm-addr-syntax">{m.syntax}</div>
                  <div className="asm-addr-desc">{m.desc}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
