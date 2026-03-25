import { useState, useEffect, useCallback, useRef } from 'react'

interface TourStep {
  target: string        // CSS selector
  title: string
  desc: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  prepare?: string      // action name to execute before showing this step
}

const TOUR_STEPS: TourStep[] = [
  {
    target: '.asm-col-editor',
    title: 'Éditeur assembleur',
    desc: 'Écrivez votre code x86-64 ici. Coloration syntaxique, autocomplétion (Tab), linter temps réel et pliage de code inclus. Clic droit pour le menu contextuel.',
    position: 'right',
  },
  {
    target: '.asm-controls',
    title: 'Contrôles',
    desc: 'Assemblez (F5), avancez pas à pas (F11), step over (F10), continuez ou reculez. Auto-step pour exécution automatique.',
    position: 'bottom',
  },
  {
    target: '.asm-regs-section',
    title: 'Registres',
    desc: 'Les registres du CPU mis à jour en temps réel. Les valeurs modifiées apparaissent en vert avec le delta. Cliquez sur un registre pour voir ses sous-registres (eax, ax, ah, al).',
    position: 'left',
  },
  {
    target: '.asm-flags-inline',
    title: 'Flags CPU',
    desc: 'Les 7 flags (ZF, CF, SF, OF, PF, AF, DF). Un flag actif pulse en rouge. Survolez pour voir une explication contextuelle.',
    position: 'left',
  },
  {
    target: '.asm-right-toolbar',
    title: 'Outils du panneau droit',
    desc: 'Accédez à la Console GDB (commandes brutes) et à l\'Évaluateur d\'expressions. Le bouton ▶ replie tout le panneau.',
    position: 'bottom',
    prepare: 'expand_right',
  },
  {
    target: '.asm-panel-section:nth-child(1)',
    title: 'Stack (Pile)',
    desc: 'Visualisez la pile d\'exécution avec les marqueurs RSP (sommet) et RBP (base du frame). Les watchpoints surveillent les changements de valeurs en mémoire.',
    position: 'left',
    prepare: 'expand_stack',
  },
  {
    target: '.asm-panel-section:nth-child(2)',
    title: 'Memory (Mémoire)',
    desc: 'Explorez les sections du binaire (.data, .bss, .text). Chargez une section pour voir son contenu octet par octet.',
    position: 'left',
    prepare: 'expand_memory',
  },
  {
    target: '.asm-panel-section:nth-child(3)',
    title: 'Security (Sécurité)',
    desc: 'Analysez les protections du binaire : checksec (NX, PIE, RELRO, canary), vmmap (carte mémoire), GOT (table des offsets) et outils d\'exploitation (cyclic, ROP gadgets).',
    position: 'left',
    prepare: 'expand_security',
  },
  {
    target: '.asm-console-drawer, .asm-right-tool',
    title: 'Console GDB',
    desc: 'Envoyez des commandes GDB brutes (info registers, x/10x $rsp, disas…). Le drawer glisse depuis la droite. Résultats affichés directement.',
    position: 'left',
    prepare: 'open_console',
  },
  {
    target: '.asm-terminal-drawer-bar',
    title: 'Terminal',
    desc: 'Sortie du programme (stdout/stderr), erreurs de compilation et messages système. Cliquez pour déplier.',
    position: 'top',
    prepare: 'close_console',
  },
  {
    target: '.asm-statusbar',
    title: 'Barre de statut',
    desc: 'Mode d\'affichage (hex/dec/bin), assembleur actif, compteur de pas et connexion. Cliquez sur Palette (Ctrl+K) pour toutes les commandes.',
    position: 'top',
  },
]

const TOUR_KEY = 'asmble_tour_done'

interface GuidedTourProps {
  open: boolean
  onClose: () => void
  onPrepare?: (action: string) => void
}

export function GuidedTour({ open, onClose, onPrepare }: GuidedTourProps) {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const current = TOUR_STEPS[step]

  const measure = useCallback(() => {
    if (!current) return
    const el = document.querySelector(current.target)
    if (el) {
      setRect(el.getBoundingClientRect())
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } else {
      setRect(null)
    }
  }, [current])

  useEffect(() => {
    if (!open) return
    setStep(0)
  }, [open])

  useEffect(() => {
    if (!open) return
    // Execute prepare action for current step
    if (current?.prepare && onPrepare) {
      onPrepare(current.prepare)
    }
    // Small delay to let DOM update after prepare
    const t = setTimeout(measure, 80)
    window.addEventListener('resize', measure)
    return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [open, step, measure, current, onPrepare])

  const finish = useCallback(() => {
    localStorage.setItem(TOUR_KEY, '1')
    onClose()
  }, [onClose])

  const next = useCallback(() => {
    if (step < TOUR_STEPS.length - 1) setStep(s => s + 1)
    else finish()
  }, [step, finish])

  const prev = useCallback(() => {
    if (step > 0) setStep(s => s - 1)
  }, [step])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, next, prev, finish])

  if (!open || !current) return null

  // Compute popover position
  const pad = 12
  let popStyle: React.CSSProperties = { position: 'fixed', zIndex: 100002, maxWidth: 340 }

  if (rect) {
    const pos = current.position || 'bottom'
    if (pos === 'bottom') {
      popStyle.top = rect.bottom + pad
      popStyle.left = rect.left + rect.width / 2
      popStyle.transform = 'translateX(-50%)'
    } else if (pos === 'top') {
      popStyle.bottom = window.innerHeight - rect.top + pad
      popStyle.left = rect.left + rect.width / 2
      popStyle.transform = 'translateX(-50%)'
    } else if (pos === 'right') {
      popStyle.top = rect.top + rect.height / 2
      popStyle.left = rect.right + pad
      popStyle.transform = 'translateY(-50%)'
    } else {
      popStyle.top = rect.top + rect.height / 2
      popStyle.right = window.innerWidth - rect.left + pad
      popStyle.transform = 'translateY(-50%)'
    }
  } else {
    popStyle.top = '50%'
    popStyle.left = '50%'
    popStyle.transform = 'translate(-50%, -50%)'
  }

  // Spotlight clip path (cut out the target rect from overlay)
  const spotInset = 6
  const spotRadius = 8
  let clipPath = 'none'
  if (rect) {
    const sx = rect.left - spotInset
    const sy = rect.top - spotInset
    const sw = rect.width + spotInset * 2
    const sh = rect.height + spotInset * 2
    // polygon with hole
    clipPath = `polygon(
      0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
      ${sx}px ${sy}px,
      ${sx}px ${sy + sh}px,
      ${sx + sw}px ${sy + sh}px,
      ${sx + sw}px ${sy}px,
      ${sx}px ${sy}px
    )`
  }

  return (
    <>
      {/* Overlay with spotlight cutout */}
      <div
        className="asm-tour-overlay"
        style={{ clipPath }}
        onClick={finish}
      />

      {/* Spotlight border (rounded rect around target) */}
      {rect && (
        <div
          className="asm-tour-spotlight"
          style={{
            position: 'fixed',
            zIndex: 100001,
            top: rect.top - spotInset,
            left: rect.left - spotInset,
            width: rect.width + spotInset * 2,
            height: rect.height + spotInset * 2,
            borderRadius: spotRadius,
            border: '2px solid #388bfd',
            boxShadow: '0 0 0 4px rgba(56,139,253,.25)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Popover card */}
      <div ref={popRef} className="asm-tour-popover" style={popStyle}>
        <div className="asm-tour-step-count">{step + 1} / {TOUR_STEPS.length}</div>
        <div className="asm-tour-title">{current.title}</div>
        <div className="asm-tour-desc">{current.desc}</div>
        <div className="asm-tour-actions">
          {step > 0 && (
            <button className="asm-tour-btn asm-tour-btn-sec" onClick={prev}>← Précédent</button>
          )}
          <button className="asm-tour-btn asm-tour-btn-skip" onClick={finish}>Passer</button>
          <button className="asm-tour-btn asm-tour-btn-primary" onClick={next}>
            {step < TOUR_STEPS.length - 1 ? 'Suivant →' : 'Terminer ✓'}
          </button>
        </div>
      </div>
    </>
  )
}

export function shouldShowTour(): boolean {
  return !localStorage.getItem(TOUR_KEY)
}
