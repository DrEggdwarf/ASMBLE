import { memo, useEffect, useState } from 'react'

interface PaletteCommand {
  label: string
  cat: string
  action: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  commands: PaletteCommand[]
}

export const CommandPalette = memo(function CommandPalette({ open, onClose, commands }: Props) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  useEffect(() => { if (open) { setQuery(''); setIndex(0) } }, [open])
  useEffect(() => { setIndex(0) }, [query])

  if (!open) return null

  const filtered = query
    ? commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()) || c.cat.toLowerCase().includes(query.toLowerCase())).slice(0, 15)
    : commands.slice(0, 15)

  return (
    <div className="asm-modal-overlay" onClick={onClose}>
      <div className="asm-palette" onClick={e => e.stopPropagation()}>
        <input
          className="asm-palette-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { onClose() }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, filtered.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)) }
            else if (e.key === 'Enter' && filtered[index]) { filtered[index].action(); onClose() }
          }}
          placeholder="Taper une commande, instruction, syscall..."
          autoFocus
        />
        <div className="asm-palette-list">
          {filtered.map((cmd, i) => (
            <div key={cmd.label} className={`asm-palette-item ${i === index ? 'active' : ''}`} onMouseEnter={() => setIndex(i)} onMouseDown={e => { e.preventDefault(); cmd.action(); onClose() }}>
              <span className="asm-palette-cat">{cmd.cat}</span>
              <span className="asm-palette-label">{cmd.label}</span>
            </div>
          ))}
          {filtered.length === 0 && <div className="asm-palette-empty">Aucun résultat</div>}
        </div>
      </div>
    </div>
  )
})
