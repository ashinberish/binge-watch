import '@nightreel/ui/tokens.css'
import '@nightreel/ui/styles.css'
import './popup.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
