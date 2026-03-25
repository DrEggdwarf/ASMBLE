import { useState, useCallback, useRef, useEffect } from 'react'

export function useColResize(initialPcts: [number, number, number]) {
  const [cols, setCols] = useState(initialPcts)
  const bodyRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<{ idx: number } | null>(null)

  const onDown = useCallback((idx: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = { idx }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !bodyRef.current) return
      const rect = bodyRef.current.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const { idx } = dragging.current
      setCols(prev => {
        const next = [...prev] as [number, number, number]
        if (idx === 0) {
          const newC0 = Math.max(15, Math.min(x, 100 - prev[2] - 15))
          next[0] = newC0
          next[1] = 100 - newC0 - prev[2]
          if (next[1] < 15) { next[1] = 15; next[0] = 100 - 15 - prev[2]; }
        } else {
          const boundary = prev[0]
          const newC01 = Math.max(boundary + 15, Math.min(x, 85))
          next[1] = newC01 - prev[0]
          next[2] = 100 - newC01
          if (next[2] < 15) { next[2] = 15; next[1] = 100 - prev[0] - 15; }
        }
        return next
      })
    }
    const onUp = () => {
      if (dragging.current) {
        dragging.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  return { cols, bodyRef, onDown }
}
