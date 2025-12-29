import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles.css'

// Suppress known @blocknote/shadcn ref warning (library bug)
// https://github.com/TypeCellOS/BlockNote/issues - TooltipButton doesn't use forwardRef
const originalError = console.error
console.error = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : ''
  if (msg.includes('Function components cannot be given refs') && msg.includes('Primitive.button.SlotClone')) {
    return
  }
  originalError.apply(console, args)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

