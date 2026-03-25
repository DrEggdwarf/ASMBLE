import { createRoot } from 'react-dom/client'
import { createElement } from 'react'
import AsmDebugger from './src/App'

createRoot(document.getElementById('root')!).render(createElement(AsmDebugger))
