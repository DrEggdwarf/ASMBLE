import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { tokenizeLine } from './tokenizer'
import { lintCode } from './linter'
import { computeFoldRegions } from './foldRegions'
import { COMPLETIONS, INSTR_INFO, kindIcon, kindClass, type CompletionItem } from './completions'

interface AsmEditorProps {
  code: string
  onChange: (code: string) => void
  activeLine: number
  className?: string
  breakpoints?: Set<number>
  onToggleBreakpoint?: (line: number) => void
  regValues?: Record<string, number>
  changedRegs?: string[]
  breadcrumb?: string[]
}

export default function AsmEditor({ code, onChange, activeLine, className, breakpoints, onToggleBreakpoint, regValues, changedRegs, breadcrumb }: AsmEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const lineNumsRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const acRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const highlightLayerRef = useRef<HTMLDivElement>(null)
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null)
  const [charW, setCharW] = useState(7.22)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  // ── Undo / Redo stack ───────────────────────────────────────────
  const undoRef = useRef<string[]>([])
  const redoRef = useRef<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSnapshotRef = useRef(code)
  const UNDO_MAX = 80

  const pushUndo = useCallback((snapshot: string) => {
    if (snapshot === undoRef.current[undoRef.current.length - 1]) return
    undoRef.current = [...undoRef.current.slice(-(UNDO_MAX - 1)), snapshot]
    redoRef.current = []
  }, [])

  const scheduleSnapshot = useCallback((prev: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      pushUndo(prev)
      lastSnapshotRef.current = prev
    }, 400)
  }, [pushUndo])

  const handleChange = useCallback((newCode: string) => {
    scheduleSnapshot(code)
    onChange(newCode)
  }, [code, onChange, scheduleSnapshot])

  const handleUndo = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
    if (lastSnapshotRef.current !== code && lastSnapshotRef.current !== undoRef.current[undoRef.current.length - 1]) {
      pushUndo(lastSnapshotRef.current)
    }
    const prev = undoRef.current.pop()
    if (prev === undefined) return
    redoRef.current.push(code)
    lastSnapshotRef.current = prev
    onChange(prev)
  }, [code, onChange, pushUndo])

  const handleRedo = useCallback(() => {
    const next = redoRef.current.pop()
    if (next === undefined) return
    undoRef.current.push(code)
    lastSnapshotRef.current = next
    onChange(next)
  }, [code, onChange])

  const [acVisible, setAcVisible] = useState(false)
  const [acItems, setAcItems] = useState<CompletionItem[]>([])
  const [acIndex, setAcIndex] = useState(0)
  const [acPos, setAcPos] = useState({ top: 0, left: 0 })
  const [acPrefix, setAcPrefix] = useState('')
  const [tooltip, setTooltip] = useState<{ text: string; syntax: string; cat: string; x: number; y: number } | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [cursorWord, setCursorWord] = useState('')
  const [foldedLines, setFoldedLines] = useState<Set<number>>(new Set())
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [findCaseSensitive, setFindCaseSensitive] = useState(false)

  const lines = useMemo(() => code.split('\n'), [code])
  const foldRegions = useMemo(() => computeFoldRegions(lines), [lines])

  const toggleFold = useCallback((startLine: number) => {
    setFoldedLines(prev => {
      const next = new Set(prev)
      if (next.has(startLine)) next.delete(startLine)
      else next.add(startLine)
      return next
    })
  }, [])

  const hiddenLines = useMemo(() => {
    const hidden = new Set<number>()
    foldRegions.forEach(r => {
      if (foldedLines.has(r.start)) {
        for (let i = r.start + 1; i <= r.end; i++) hidden.add(i)
      }
    })
    return hidden
  }, [foldRegions, foldedLines])

  const lintErrors = useMemo(() => lintCode(lines), [lines])

  const labelPositions = useMemo(() => {
    const map = new Map<string, number>()
    lines.forEach((line, i) => {
      const m = line.match(/^[ \t]*([a-zA-Z_.@$][a-zA-Z0-9_.@$]*):/)
      if (m) map.set(m[1].toLowerCase(), i)
    })
    return map
  }, [lines])

  const findMatches = useMemo(() => {
    if (!findOpen || !findText) return []
    const matches: { line: number; col: number; len: number }[] = []
    const search = findCaseSensitive ? findText : findText.toLowerCase()
    lines.forEach((line, i) => {
      const hay = findCaseSensitive ? line : line.toLowerCase()
      let idx = 0
      while ((idx = hay.indexOf(search, idx)) !== -1) {
        matches.push({ line: i, col: idx, len: findText.length })
        idx += findText.length || 1
      }
    })
    return matches
  }, [findOpen, findText, findCaseSensitive, lines])

  // ── Scroll sync ─────────────────────────────────────────────────────

  // Measure actual monospace character width
  useEffect(() => {
    const pre = highlightRef.current
    if (!pre) return
    const span = document.createElement('span')
    span.style.cssText = 'visibility:hidden;position:absolute;white-space:pre;font:inherit'
    span.textContent = 'MMMMMMMMMM'
    pre.appendChild(span)
    const w = span.getBoundingClientRect().width / 10
    pre.removeChild(span)
    if (w > 0) setCharW(w)
  }, [])

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const st = ta.scrollTop
    const sl = ta.scrollLeft
    setScrollTop(st)
    setScrollLeft(sl)
    if (lineNumsRef.current) lineNumsRef.current.scrollTop = st
    // Apply transform immediately to avoid 1-frame desync
    if (highlightLayerRef.current) {
      highlightLayerRef.current.style.transform = `translate(${-sl}px, ${-st}px)`
    }
  }, [])

  // ── Current scope word ─────────────────────────────────────────────

  const updateCursorWord = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const pos = ta.selectionStart
    const before = code.slice(0, pos)
    const after = code.slice(pos)
    const bm = before.match(/([a-zA-Z_.@$][a-zA-Z0-9_.@$]*)$/)
    const am = after.match(/^([a-zA-Z0-9_.@$]*)/)
    const word = (bm ? bm[1] : '') + (am ? am[1] : '')
    setCursorWord(word.length >= 2 ? word.toLowerCase() : '')
  }, [code])

  const scopeHighlights = useMemo(() => {
    if (!cursorWord || cursorWord.length < 2) return []
    const matches: { line: number; col: number; len: number }[] = []
    lines.forEach((line, i) => {
      const lower = line.toLowerCase()
      let idx = 0
      while ((idx = lower.indexOf(cursorWord, idx)) !== -1) {
        const before = idx > 0 ? lower[idx - 1] : ' '
        const after = idx + cursorWord.length < lower.length ? lower[idx + cursorWord.length] : ' '
        if (!/[a-zA-Z0-9_.]/.test(before) && !/[a-zA-Z0-9_.]/.test(after)) {
          matches.push({ line: i, col: idx, len: cursorWord.length })
        }
        idx += cursorWord.length || 1
      }
    })
    return matches.length > 1 ? matches : []
  }, [cursorWord, lines])

  // ── Highlight rendering ─────────────────────────────────────────────

  const highlightedContent = useMemo(() => {
    const result: React.ReactNode[] = []
    lines.forEach((line, i) => {
      if (hiddenLines.has(i)) {
        if (i < lines.length - 1) result.push('\n')
        return
      }
      const tokens = tokenizeLine(line)
      tokens.forEach((t, j) => {
        result.push(
          <span key={`${i}-${j}`} className={`asm-tok-${t.type}`} data-token-type={t.type} data-token-text={t.text.toLowerCase()} data-line={i}>
            {t.text}
          </span>
        )
      })
      if (i < lines.length - 1) result.push('\n')
    })
    return result
  }, [lines, hiddenLines])

  // ── Autocomplete ──────────────────────────────────────────────────

  const getWordAtCursor = useCallback((): { word: string; start: number; end: number; line: number } | null => {
    const ta = textareaRef.current
    if (!ta) return null
    const pos = ta.selectionStart
    const textBefore = code.slice(0, pos)
    const linesBefore = textBefore.split('\n')
    const currentLine = linesBefore[linesBefore.length - 1]
    const match = currentLine.match(/([a-zA-Z_.%][a-zA-Z0-9_.%]*)$/)
    if (!match) return null
    return { word: match[1], start: pos - match[1].length, end: pos, line: linesBefore.length - 1 }
  }, [code])

  const updateAutocomplete = useCallback(() => {
    const info = getWordAtCursor()
    if (!info || info.word.length < 1) { setAcVisible(false); return }
    const prefix = info.word.toLowerCase()
    const filtered = COMPLETIONS.filter(c => c.label.toLowerCase().startsWith(prefix) && c.label.toLowerCase() !== prefix).slice(0, 12)
    if (filtered.length === 0) { setAcVisible(false); return }
    const ta = textareaRef.current
    const editor = editorRef.current
    if (!ta || !editor) return
    const taRect = ta.getBoundingClientRect()
    const edRect = editor.getBoundingClientRect()
    const textBefore = code.slice(0, info.start)
    const lb = textBefore.split('\n')
    const top = (lb.length) * 20 - ta.scrollTop + 8 + (taRect.top - edRect.top)
    const left = lb[lb.length - 1].length * charW + 10 - ta.scrollLeft + (taRect.left - edRect.left)
    setAcItems(filtered); setAcIndex(0); setAcPos({ top, left }); setAcPrefix(prefix); setAcVisible(true)
  }, [code, getWordAtCursor])

  const applyCompletion = useCallback((item: CompletionItem) => {
    const info = getWordAtCursor()
    if (!info) return
    pushUndo(code)
    onChange(code.slice(0, info.start) + item.insert + code.slice(info.end))
    setAcVisible(false)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) { ta.selectionStart = ta.selectionEnd = info.start + item.insert.length; ta.focus() }
    })
  }, [code, getWordAtCursor, onChange, pushUndo])

  // ── Find & Replace ────────────────────────────────────────────────

  const handleReplaceOne = useCallback(() => {
    if (!findText || findMatches.length === 0) return
    const m = findMatches[0]
    const before = lines.slice(0, m.line).join('\n')
    const prefix = before ? before + '\n' : ''
    const currentLine = lines[m.line]
    const newLine = currentLine.slice(0, m.col) + replaceText + currentLine.slice(m.col + m.len)
    const after = lines.slice(m.line + 1).join('\n')
    pushUndo(code)
    onChange(prefix + newLine + (lines.length > m.line + 1 ? '\n' + after : ''))
  }, [findText, replaceText, findMatches, lines, code, onChange, pushUndo])

  const handleReplaceAll = useCallback(() => {
    if (!findText) return
    const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    pushUndo(code)
    onChange(code.replace(new RegExp(escaped, findCaseSensitive ? 'g' : 'gi'), replaceText))
  }, [findText, replaceText, findCaseSensitive, code, onChange, pushUndo])

  // ── Keyboard ──────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); return }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); handleRedo(); return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); setFindOpen(v => !v); setTimeout(() => findInputRef.current?.focus(), 50); return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') { e.preventDefault(); setFindOpen(true); setTimeout(() => findInputRef.current?.focus(), 50); return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); textareaRef.current?.select(); return }

    if (acVisible) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIndex(i => Math.min(i + 1, acItems.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAcIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyCompletion(acItems[acIndex]); return }
      if (e.key === 'Escape') { e.preventDefault(); setAcVisible(false); return }
    }
    if (e.key === 'Escape' && findOpen) { setFindOpen(false); return }
    if (e.key === 'Tab' && !acVisible) {
      e.preventDefault()
      const ta = e.currentTarget, start = ta.selectionStart, end = ta.selectionEnd
      pushUndo(code)
      onChange(code.slice(0, start) + '    ' + code.slice(end))
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 4 })
    }
  }, [acVisible, acItems, acIndex, applyCompletion, code, onChange, findOpen, pushUndo, handleUndo, handleRedo])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => { setTooltip(null); handleChange(e.target.value) }, [handleChange])

  // Ctrl+click label jump
  const handleEditorClick = useCallback((e: React.MouseEvent<HTMLPreElement>) => {
    if (!e.ctrlKey && !e.metaKey) return
    const target = e.target as HTMLElement
    const tokenText = target.dataset.tokenText
    if (tokenText) {
      const lineIdx = labelPositions.get(tokenText)
      if (lineIdx !== undefined) {
        e.preventDefault()
        const ta = textareaRef.current
        if (ta) {
          let pos = 0
          for (let i = 0; i < lineIdx; i++) pos += lines[i].length + 1
          ta.selectionStart = ta.selectionEnd = pos
          ta.focus()
          ta.scrollTop = lineIdx * 20 - ta.clientHeight / 2
          syncScroll()
        }
      }
    }
  }, [labelPositions, lines, syncScroll])

  // Update autocomplete & cursor word
  useEffect(() => {
    const ta = textareaRef.current
    if (ta && document.activeElement === ta) {
      const t = setTimeout(() => { updateAutocomplete(); updateCursorWord() }, 30)
      return () => clearTimeout(t)
    }
  }, [code, updateAutocomplete, updateCursorWord])

  // Flip autocomplete popup if it overflows the editor
  useEffect(() => {
    if (!acVisible || !acRef.current || !editorRef.current) return
    const popup = acRef.current
    const editor = editorRef.current
    const popRect = popup.getBoundingClientRect()
    const edRect = editor.getBoundingClientRect()
    if (popRect.bottom > edRect.bottom) {
      popup.style.top = `${acPos.top - popRect.height - 20}px`
    }
    if (popRect.right > edRect.right) {
      popup.style.left = `${Math.max(0, edRect.right - edRect.left - popRect.width - 4)}px`
    }
  }, [acVisible, acPos])

  // Flip tooltip upward if it overflows the editor bottom
  useEffect(() => {
    if (!tooltip || !tooltipRef.current || !editorRef.current) return
    const tip = tooltipRef.current
    const editor = editorRef.current
    const tipRect = tip.getBoundingClientRect()
    const edRect = editor.getBoundingClientRect()
    if (tipRect.bottom > edRect.bottom) {
      tip.style.top = `${tooltip.y - tipRect.height - 8}px`
    }
  }, [tooltip])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    const handler = () => updateCursorWord()
    ta.addEventListener('click', handler)
    ta.addEventListener('keyup', handler)
    return () => { ta.removeEventListener('click', handler); ta.removeEventListener('keyup', handler) }
  }, [updateCursorWord])

  // ── Hover tooltip ─────────────────────────────────────────────────

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLPreElement>) => {
    const target = e.target as HTMLElement
    const lineStr = target.dataset.line
    const lineIdx = lineStr !== undefined ? parseInt(lineStr) : -1

    // Instruction tooltip
    if (target.dataset.tokenType === 'keyword') {
      const word = target.dataset.tokenText
      if (word) {
        const info = INSTR_INFO.get(word)
        if (info) {
          const rect = target.getBoundingClientRect()
          const editorRect = editorRef.current?.getBoundingClientRect()
          if (editorRect) {
            setTooltip({ text: info.desc, syntax: info.syntax, cat: info.cat, x: rect.left - editorRect.left, y: rect.bottom - editorRect.top + 4 })
            return
          }
        }
      }
    }

    // Lint error tooltip
    if (lineIdx >= 0) {
      const errs = lintErrors.filter(e => e.line === lineIdx)
      if (errs.length > 0) {
        const rect = target.getBoundingClientRect()
        const editorRect = editorRef.current?.getBoundingClientRect()
        if (editorRect) {
          setTooltip({ text: errs[0].msg, syntax: errs[0].severity === 'error' ? 'Error' : 'Warning', cat: 'LINT', x: rect.left - editorRect.left, y: rect.bottom - editorRect.top + 4 })
          return
        }
      }
    }

    // Register value tooltip
    if (target.dataset.tokenType === 'register' && regValues) {
      const regName = target.dataset.tokenText?.replace('%', '')
      if (regName && regName in regValues) {
        const rect = target.getBoundingClientRect()
        const editorRect = editorRef.current?.getBoundingClientRect()
        if (editorRect) {
          const v = regValues[regName]
          const isChanged = changedRegs?.includes(regName)
          setTooltip({ text: `hex: 0x${BigInt.asUintN(64, BigInt(v)).toString(16)}\ndec: ${v}`, syntax: regName + (isChanged ? ' ★' : ''), cat: 'REGISTER', x: rect.left - editorRect.left, y: rect.bottom - editorRect.top + 4 })
          return
        }
      }
    }

    // Ctrl+hover label hint
    if (e.ctrlKey && target.dataset.tokenText) {
      const lbl = target.dataset.tokenText
      if (labelPositions.has(lbl)) {
        const rect = target.getBoundingClientRect()
        const editorRect = editorRef.current?.getBoundingClientRect()
        if (editorRect) {
          const destLine = labelPositions.get(lbl)!
          setTooltip({ text: `Go to definition (line ${destLine + 1})`, syntax: lbl, cat: 'LABEL', x: rect.left - editorRect.left, y: rect.bottom - editorRect.top + 4 })
          return
        }
      }
    }

    setTooltip(null)
  }, [lintErrors, labelPositions])

  const handleMouseLeave = useCallback(() => { setTooltip(null) }, [])

  // Scroll active line into view (useLayoutEffect to avoid black flash)
  useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta || activeLine <= 0) return
    const targetTop = (activeLine - 1) * 20
    if (targetTop < ta.scrollTop || targetTop + 20 > ta.scrollTop + ta.clientHeight) {
      ta.scrollTop = Math.max(0, targetTop - ta.clientHeight / 2)
      syncScroll()
    }
  }, [activeLine, syncScroll])

  // ── Computed decorations ──────────────────────────────────────────

  const indentGuides = useMemo(() => {
    const guides: React.ReactNode[] = []
    lines.forEach((line, i) => {
      if (hiddenLines.has(i)) return
      const spaces = line.match(/^( *)/)?.[1].length || 0
      const levels = Math.floor(spaces / 4)
      for (let lvl = 0; lvl < levels; lvl++) {
        guides.push(<div key={`${i}-${lvl}`} className="asm-ed-indent-guide" style={{ top: `${i * 20 + 8}px`, left: `${lvl * 4 * charW + 10}px` }} />)
      }
    })
    return guides
  }, [lines, hiddenLines, charW])

  const errorUnderlines = useMemo(() => lintErrors.map((err, i) => (
    <div key={`err-${i}`} className={`asm-ed-error-underline ${err.severity}`} style={{ top: `${err.line * 20 + 8 + 16}px`, left: `${err.col * charW + 10}px`, width: `${Math.max(err.len, 1) * charW}px` }} />
  )), [lintErrors, charW])

  const scopeDivs = useMemo(() => scopeHighlights.map((m, i) => (
    <div key={`scope-${i}`} className="asm-ed-scope-highlight" style={{ top: `${m.line * 20 + 8}px`, left: `${m.col * charW + 10}px`, width: `${m.len * charW}px` }} />
  )), [scopeHighlights, charW])

  const findDivs = useMemo(() => findMatches.map((m, i) => (
    <div key={`find-${i}`} className="asm-ed-find-highlight" style={{ top: `${m.line * 20 + 8}px`, left: `${m.col * charW + 10}px`, width: `${m.len * charW}px` }} />
  )), [findMatches, charW])

  // Jump arrows — find jump/call instructions and their target labels
  // Assign depth levels so arrows with overlapping vertical spans don't cross
  const jumpArrows = useMemo(() => {
    const raw: { from: number; to: number }[] = []
    lines.forEach((line, i) => {
      const m = line.match(/^\s*(jmp|je|jz|jne|jnz|jl|jle|jg|jge|jb|ja|jnge|jng|jnle|jnl|jnae|jnbe|js|jo|loop|call)\s+([a-zA-Z_.@$][a-zA-Z0-9_.@$]*)/i)
      if (m) {
        const target = labelPositions.get(m[2].toLowerCase())
        if (target !== undefined && target !== i) {
          raw.push({ from: i, to: target })
        }
      }
    })
    // Sort by span size (smaller spans get inner levels)
    const sorted = raw.map(a => ({ ...a, minL: Math.min(a.from, a.to), maxL: Math.max(a.from, a.to) }))
      .sort((a, b) => (a.maxL - a.minL) - (b.maxL - b.minL))
    // Assign levels: check overlap with already-assigned arrows
    const assigned: { minL: number; maxL: number; level: number }[] = []
    return sorted.map(a => {
      let level = 0
      const overlapping = assigned.filter(b => !(a.maxL < b.minL || a.minL > b.maxL))
      const usedLevels = new Set(overlapping.map(b => b.level))
      while (usedLevels.has(level)) level++
      assigned.push({ minL: a.minL, maxL: a.maxL, level })
      return { from: a.from, to: a.to, level }
    })
  }, [lines, labelPositions])

  // Dynamic arrow gutter width: base 30px, grows by 5px per extra level beyond 3
  const maxArrowLevel = jumpArrows.reduce((m, a) => Math.max(m, a.level), -1)
  const arrowGutterW = Math.max(30, 20 + (maxArrowLevel + 1) * 5)

  // Error counts
  const errCount = lintErrors.filter(e => e.severity === 'error').length
  const warnCount = lintErrors.filter(e => e.severity === 'warning').length

  // Inline register lens — show changed register values at end of active line
  const regLens = useMemo(() => {
    if (!regValues || !changedRegs || changedRegs.length === 0 || activeLine <= 0) return null
    const lineIdx = activeLine - 1
    if (lineIdx < 0 || lineIdx >= lines.length) return null
    const lineLen = lines[lineIdx].length
    const regsToShow = changedRegs.filter(r => r !== 'rip' && r in regValues).slice(0, 4)
    if (regsToShow.length === 0) return null
    const text = regsToShow.map(r => `${r}=0x${BigInt.asUintN(64, BigInt(regValues[r])).toString(16)}`).join('  ')
    return (
      <div className="asm-ed-reg-lens" style={{ top: `${lineIdx * 20 + 8}px`, left: `${(lineLen + 3) * charW + 10}px` }}>
        {text}
      </div>
    )
  }, [regValues, changedRegs, activeLine, lines, charW])

  // ── Minimap ──────────────────────────────────────────────────────
  const MINIMAP_W = 60
  const MINIMAP_LINE_H = 2
  const MINIMAP_SCALE = 1.4

  useEffect(() => {
    const canvas = minimapCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const h = Math.max(lines.length * MINIMAP_LINE_H + 4, 40)
    canvas.width = MINIMAP_W * 2  // retina
    canvas.height = h * 2
    canvas.style.height = h + 'px'
    ctx.scale(2, 2)
    ctx.clearRect(0, 0, MINIMAP_W, h)

    const TOKEN_COLORS: Record<string, string> = {
      keyword: '#7aa2f7', register: '#ff9e64', number: '#e0af68',
      string: '#9ece6a', directive: '#bb9af7', label: '#73daca',
      comment: '#565f89', operator: '#89ddff', flag: '#f7768e',
    }

    lines.forEach((line, i) => {
      if (hiddenLines.has(i)) return
      const y = i * MINIMAP_LINE_H
      // Active line highlight
      if (i + 1 === activeLine) {
        ctx.fillStyle = 'rgba(122, 162, 247, 0.25)'
        ctx.fillRect(0, y, MINIMAP_W, MINIMAP_LINE_H)
      }
      // Breakpoint mark
      if (breakpoints?.has(i + 1)) {
        ctx.fillStyle = 'rgba(247, 118, 142, 0.5)'
        ctx.fillRect(0, y, 2, MINIMAP_LINE_H)
      }
      // Render token blocks
      const tokens = tokenizeLine(line)
      let x = 1
      tokens.forEach(t => {
        const color = TOKEN_COLORS[t.type]
        if (color && t.text.trim()) {
          ctx.fillStyle = color + '90'
          ctx.fillRect(x * MINIMAP_SCALE, y, Math.max(t.text.length * MINIMAP_SCALE, 1), MINIMAP_LINE_H)
        }
        x += t.text.length
      })
    })
  }, [lines, hiddenLines, activeLine, breakpoints])

  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = minimapCanvasRef.current
    const ta = textareaRef.current
    if (!canvas || !ta) return
    const rect = canvas.getBoundingClientRect()
    const y = e.clientY - rect.top
    const targetLine = Math.floor(y / MINIMAP_LINE_H)
    ta.scrollTop = Math.max(0, targetLine * 20 - ta.clientHeight / 2)
    syncScroll()
  }, [syncScroll])

  // ── Context menu ────────────────────────────────────────────────

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const edRect = editorRef.current?.getBoundingClientRect()
    if (!edRect) return
    setCtxMenu({ x: e.clientX - edRect.left, y: e.clientY - edRect.top })
  }, [])

  // Close context menu on any click / escape
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    const escClose = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('keydown', escClose)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', escClose) }
  }, [ctxMenu])

  const ctxActions = useMemo(() => {
    const ta = textareaRef.current
    return [
      { label: 'Couper', shortcut: 'Ctrl+X', action: () => { document.execCommand('cut') } },
      { label: 'Copier', shortcut: 'Ctrl+C', action: () => { document.execCommand('copy') } },
      { label: 'Coller', shortcut: 'Ctrl+V', action: () => { ta?.focus(); document.execCommand('paste') } },
      null, // separator
      { label: 'Tout sélectionner', shortcut: 'Ctrl+A', action: () => { ta?.select() } },
      { label: 'Rechercher', shortcut: 'Ctrl+F', action: () => { setFindOpen(true); setTimeout(() => findInputRef.current?.focus(), 50) } },
      null,
      { label: 'Annuler', shortcut: 'Ctrl+Z', action: handleUndo },
      { label: 'Refaire', shortcut: 'Ctrl+Y', action: handleRedo },
      null,
      { label: activeLine > 0 ? `Breakpoint ligne ${activeLine}` : 'Toggle breakpoint', shortcut: 'F9', action: () => { if (activeLine > 0) onToggleBreakpoint?.(activeLine) } },
    ] as ({ label: string; shortcut: string; action: () => void } | null)[]
  }, [activeLine, handleUndo, handleRedo, onToggleBreakpoint])

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className={`asm-editor-pro ${className || ''}`} ref={editorRef}>
      {/* Breadcrumb */}
      {breadcrumb && breadcrumb.length > 0 && (
        <div className="asm-ed-breadcrumb">
          {breadcrumb.map((part, i) => (
            <span key={i}>
              {i > 0 && <span className="asm-ed-breadcrumb-sep">&rsaquo;</span>}
              <span className={`asm-ed-breadcrumb-part ${i === breadcrumb.length - 1 ? 'current' : ''}`}>{part}</span>
            </span>
          ))}
        </div>
      )}

      {/* Find & Replace */}
      {findOpen && (
        <div className="asm-ed-find-bar">
          <div className="asm-ed-find-row">
            <input ref={findInputRef} className="asm-ed-find-input" value={findText} onChange={e => setFindText(e.target.value)} placeholder="Find..." onKeyDown={e => { if (e.key === 'Escape') setFindOpen(false) }} />
            <button className={`asm-ed-find-btn ${findCaseSensitive ? 'active' : ''}`} onClick={() => setFindCaseSensitive(v => !v)} title="Case sensitive">Aa</button>
            <span className="asm-ed-find-count">{findMatches.length > 0 ? `${findMatches.length} found` : findText ? 'No results' : ''}</span>
          </div>
          <div className="asm-ed-find-row">
            <input className="asm-ed-find-input" value={replaceText} onChange={e => setReplaceText(e.target.value)} placeholder="Replace..." onKeyDown={e => { if (e.key === 'Escape') setFindOpen(false) }} />
            <button className="asm-ed-find-btn" onClick={handleReplaceOne} title="Replace next">1</button>
            <button className="asm-ed-find-btn" onClick={handleReplaceAll} title="Replace all">All</button>
          </div>
          <button className="asm-ed-find-close" onClick={() => setFindOpen(false)}>x</button>
        </div>
      )}

      {/* Editor body (row: linenums + content) */}
      <div className="asm-ed-body">
        {/* Line numbers + fold */}
        <div className="asm-ed-linenums" ref={lineNumsRef} style={{ paddingLeft: arrowGutterW }}>
        {lines.map((_, i) => {
          if (hiddenLines.has(i)) return <div key={i} className="asm-ed-linenum hidden" />
          const lineNum = i + 1
          const isActive = lineNum === activeLine
          const hasError = lintErrors.some(e => e.line === i && e.severity === 'error')
          const hasWarning = !hasError && lintErrors.some(e => e.line === i && e.severity === 'warning')
          const foldRegion = foldRegions.find(r => r.start === i)
          const isFolded = foldedLines.has(i)
          const hasBp = breakpoints?.has(lineNum)
          return (
            <div key={i} className={`asm-ed-linenum ${isActive ? 'active' : ''} ${hasError ? 'has-error' : ''} ${hasWarning ? 'has-warning' : ''} ${hasBp ? 'has-bp' : ''}`}>
              {foldRegion ? (
                <span className={`asm-ed-fold-toggle ${isFolded ? 'folded' : ''}`} onClick={() => toggleFold(i)}>{isFolded ? '+' : '-'}</span>
              ) : (
                <span className="asm-ed-fold-spacer" />
              )}
              <span className="asm-ed-linenum-n" onClick={() => onToggleBreakpoint?.(lineNum)} style={{ cursor: 'pointer' }}>
                {hasBp && <span className="asm-ed-bp-dot" />}
                {lineNum}
              </span>
              {isActive && <span className="asm-ed-rip">&gt;</span>}
            </div>
          )
        })}
        {/* Jump arrows SVG overlay — left side */}
        <svg className="asm-ed-jump-arrows" style={{ height: lines.length * 20 + 16, width: arrowGutterW }}>
          {jumpArrows.map((a, i) => {
            const fromY = a.from * 20 + 18
            const toY = a.to * 20 + 18
            const isCurrentJump = a.from === activeLine - 1
            const svgW = arrowGutterW
            const x0 = svgW - 4
            const xIndent = Math.max(3, svgW - 10 - a.level * 5)
            const col = isCurrentJump ? '#7aa2f7' : '#3b4261'
            const sw = isCurrentJump ? 1.5 : 1
            return (
              <g key={i} className={`asm-ed-jump-arrow ${isCurrentJump ? 'active' : ''}`}>
                <path d={`M ${x0} ${fromY} H ${xIndent} V ${toY} H ${x0}`} fill="none" stroke={col} strokeWidth={sw} />
                <polygon points={`${x0},${toY - 3} ${x0},${toY + 3} ${svgW},${toY}`} fill={col} />
              </g>
            )
          })}
        </svg>
      </div>

      {/* Editor content */}
      <div className="asm-ed-content">
        {/* Decoration layer */}
        <div className="asm-ed-highlight-layer" ref={highlightLayerRef} style={{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }}>
          {activeLine > 0 && <div className="asm-ed-active-line" style={{ top: `${(activeLine - 1) * 20 + 8}px` }} />}
          {indentGuides}
          {scopeDivs}
          {findDivs}
          {errorUnderlines}
          {regLens}
          <pre className="asm-ed-highlight" ref={highlightRef} aria-hidden="true" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} onClick={handleEditorClick}>
            <code>{highlightedContent}</code>
          </pre>
        </div>

        {/* Textarea */}
        <textarea ref={textareaRef} className="asm-ed-textarea" value={code} onChange={handleInput} onKeyDown={handleKeyDown} onScroll={syncScroll} onBlur={() => setTimeout(() => setAcVisible(false), 150)} onContextMenu={handleContextMenu} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" />

        {/* Minimap */}
        <canvas
          ref={minimapCanvasRef}
          className="asm-ed-minimap"
          width={MINIMAP_W * 2}
          height={80}
          style={{ width: MINIMAP_W }}
          onClick={handleMinimapClick}
          title="Minimap — cliquez pour naviguer"
        />
      </div>
      </div>

      {/* Autocomplete — rendered outside overflow:hidden containers */}
      {acVisible && acItems.length > 0 && (
        <div className="asm-ac-popup" ref={acRef} style={{ top: acPos.top, left: acPos.left }}>
          <div className="asm-ac-list">
            {acItems.map((item, i) => (
              <div key={item.label + item.kind} className={`asm-ac-item ${i === acIndex ? 'active' : ''}`} onMouseDown={e => { e.preventDefault(); applyCompletion(item) }} onMouseEnter={() => setAcIndex(i)}>
                <span className={`asm-ac-icon ${kindClass(item.kind)}`}>{kindIcon(item.kind)}</span>
                <span className="asm-ac-label"><span className="asm-ac-match">{item.label.slice(0, acPrefix.length)}</span><span>{item.label.slice(acPrefix.length)}</span></span>
              </div>
            ))}
          </div>
          {acItems[acIndex] && (
            <div className="asm-ac-detail">
              <div className="asm-ac-detail-title">{acItems[acIndex].label}</div>
              <div className="asm-ac-detail-desc">{acItems[acIndex].detail}</div>
            </div>
          )}
        </div>
      )}

      {/* Tooltip — rendered outside overflow:hidden containers */}
      {tooltip && (
        <div className="asm-ed-tooltip" ref={tooltipRef} style={{ top: tooltip.y, left: tooltip.x }}>
          <div className="asm-ed-tooltip-cat">{tooltip.cat}</div>
          <div className="asm-ed-tooltip-syntax">{tooltip.syntax}</div>
          <div className="asm-ed-tooltip-desc">{tooltip.text}</div>
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <div className="asm-ed-ctxmenu" style={{ top: ctxMenu.y, left: ctxMenu.x }}>
          {ctxActions.map((item, i) => item === null
            ? <div key={i} className="asm-ed-ctxmenu-sep" />
            : <div key={i} className="asm-ed-ctxmenu-item" onMouseDown={e => { e.preventDefault(); item.action(); setCtxMenu(null) }}>
                <span>{item.label}</span>
                <span className="asm-ed-ctxmenu-shortcut">{item.shortcut}</span>
              </div>
          )}
        </div>
      )}

      {/* Status bar */}
      {(errCount > 0 || warnCount > 0) && (
        <div className="asm-ed-status-bar">
          {errCount > 0 && <span className="asm-ed-status-item err">{errCount} error{errCount > 1 ? 's' : ''}</span>}
          {warnCount > 0 && <span className="asm-ed-status-item warn">{warnCount} warning{warnCount > 1 ? 's' : ''}</span>}
        </div>
      )}
    </div>
  )
}
