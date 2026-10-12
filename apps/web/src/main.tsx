import '@nightreel/ui/fonts.css'
import '@nightreel/ui/styles.css'
import './app/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from './app/providers'
import { installAuthBridge } from './features/auth'

installAuthBridge()

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
)
