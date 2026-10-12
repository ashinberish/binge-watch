import '@nightreel/ui/tokens.css'
import '@nightreel/ui/styles.css'

import { createRoot } from 'react-dom/client'

function SidePanel() {
  // TODO(phase 3): season episode list and the current streak for the open show
  return (
    <main style={{ padding: 'var(--nr-space-4)', color: 'var(--nr-ink)' }}>
      <h1>Episodes</h1>
      <p>Open a show on a supported site to see its episodes here.</p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<SidePanel />)
