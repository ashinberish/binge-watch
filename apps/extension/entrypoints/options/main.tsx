import '@nightreel/ui/styles.css'
import '../../src/styles/pages.css'
import './options.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { SettingsForm } from '../../src/features/settings/SettingsForm'

function Options() {
  return (
    <main className="nr-page">
      <span className="nr-wordmark">
        nightreel<span className="nr-wordmark__dot">.</span>
      </span>
      <h1 className="nr-page__title">Settings</h1>
      <SettingsForm />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
)
