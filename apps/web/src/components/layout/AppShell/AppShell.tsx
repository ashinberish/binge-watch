import type { Theme } from '@nightreel/ui'
import type { ReactNode } from 'react'
import './AppShell.css'

export interface AppShellProps {
  /** Top navigation, usually <TopNav />. */
  header: ReactNode
  /** Theme for the page body. Account pages pass "light". */
  theme?: Theme
  children: ReactNode
}

/** Page frame: skip link, sticky header and a centred main column. */
export function AppShell({ header, theme, children }: AppShellProps) {
  return (
    <div className="nr-shell" data-theme={theme}>
      <a className="nr-shell__skip" href="#main">
        Skip to content
      </a>
      {header}
      <main id="main" className="nr-shell__main" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}
