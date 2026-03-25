import { useState, useCallback, useRef, useEffect } from 'react'

export function useTermResize(initial: number) {
  const [h, setH] = useState(initial)
  const rootRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const onDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !rootRef.current) return
      const rect = rootRef.current.getBoundingClientRect()
      const fromBottom = rect.bottom - e.clientY
      setH(Math.max(60, Math.min(fromBottom, rect.height * 0.6)))
    }
    const onUp = () => {
      if (dragging.current) {
        dragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  return { h, rootRef, onDown }
}
