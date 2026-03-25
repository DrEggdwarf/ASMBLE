import { memo } from 'react'
import type { StepSnapshot } from '../../data/types'
import { MEMORY_SECTIONS } from '../../data'

interface Props {
  cur: StepSnapshot
  isLive: boolean
  sectionEntries: Record<string, { addr: number; val: number }[]>
  onLoadSection: (name: string) => void
}

export const MemoryPanel = memo(function MemoryPanel({
  cur, isLive, sectionEntries, onLoadSection,
}: Props) {
  return (
    <div className="asm-memory-view">
      {cur.disassembly && cur.disassembly.length > 0 ? (
        <>
          <div className="asm-mem-section">
            <div className="asm-mem-section-head">
              <span className="asm-mem-section-name">.text</span>
              <span className="asm-mem-section-range">0x{cur.disassembly[0].addr.toString(16)}</span>
              <span className="asm-mem-section-desc">Désassemblage live (GDB)</span>
            </div>
            <div className="asm-mem-entries">
              {cur.disassembly.map(e => {
                const isActive = e.addr === cur.regs.rip
                return (
                  <div key={e.addr} className={`asm-mem-entry ${isActive ? 'active' : ''}`}>
                    <span className="asm-mem-addr">0x{e.addr.toString(16)}</span>
                    {e.label && <span className="asm-mem-label">{e.label}</span>}
                    {e.bytes && <span className="asm-mem-bytes">{e.bytes}</span>}
                    <span className="asm-mem-instr">{e.instr}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {cur.sections && cur.sections.filter(s => s.name !== '.text').map(sec => (
            <div key={sec.name} className="asm-mem-section">
              <div className="asm-mem-section-head asm-mem-section-clickable" onClick={() => {
                if (isLive && !sectionEntries[sec.name]) onLoadSection(sec.name)
              }}>
                <span className="asm-mem-section-name">{sec.name}</span>
                <span className="asm-mem-section-range">0x{sec.start.toString(16)} — 0x{sec.end.toString(16)}</span>
                <span className="asm-mem-section-desc">{sec.size} bytes {!sectionEntries[sec.name] ? '(cliquer pour charger)' : ''}</span>
              </div>
              {sectionEntries[sec.name] && (
                <div className="asm-mem-entries">
                  {sectionEntries[sec.name].map((e, i) => (
                    <div key={i} className="asm-mem-entry">
                      <span className="asm-mem-addr">0x{e.addr.toString(16)}</span>
                      <span className="asm-mem-val">0x{BigInt.asUintN(64, BigInt(e.val)).toString(16)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      ) : (
        MEMORY_SECTIONS.map(sec => (
          <div key={sec.name} className="asm-mem-section">
            <div className="asm-mem-section-head">
              <span className="asm-mem-section-name">{sec.name}</span>
              <span className="asm-mem-section-range">0x{sec.start.toString(16)}</span>
              <span className="asm-mem-section-desc">{sec.desc}</span>
            </div>
            <div className="asm-mem-entries">
              {sec.entries.map(e => {
                const isActive = e.addr === cur.regs.rip || (e.instr === cur.instr && cur.instr !== null)
                return (
                  <div key={e.addr} className={`asm-mem-entry ${isActive ? 'active' : ''}`}>
                    <span className="asm-mem-addr">0x{e.addr.toString(16)}</span>
                    {e.label && <span className="asm-mem-label">{e.label}</span>}
                    <span className="asm-mem-bytes">{e.bytes}</span>
                    <span className="asm-mem-instr">{e.instr}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
})
