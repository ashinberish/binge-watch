import '@nightreel/ui/tokens.css'
import '@nightreel/ui/styles.css'

import { createRoot } from 'react-dom/client'

function Options() {
  // TODO(phase 3): supported sites list and countdown length, saved to chrome.storage.local
  return (
    <main style={{ padding: 'var(--nr-space-8)', color: 'var(--nr-ink)' }}>
      <h1>Settings</h1>
      <p>Choose which sites Nightreel follows and how long the next-episode countdown runs.</p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Options />)
