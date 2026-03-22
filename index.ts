import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'
import type { AppModule } from '../../types'
import AsmDebugger from './App'

export function createAsmbleModule(): AppModule {
  let root: Root | null = null

  return {
    mount(container: HTMLElement) {
      root = createRoot(container)
      root.render(createElement(AsmDebugger))
    },
    unmount() {
      root?.unmount()
      root = null
    },
  }
}
