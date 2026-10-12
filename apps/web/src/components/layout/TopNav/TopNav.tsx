import { Link, type LinkProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import './TopNav.css'

export interface TopNavLink {
  to: LinkProps['to']
  label: string
}

export interface TopNavProps {
  links?: TopNavLink[]
  /** Right-hand slot, e.g. the account menu. */
  actions?: ReactNode
}

/** "nightreel" in Archivo Narrow 700, lowercase, with the brand-red dot. */
export function Wordmark() {
  return (
    <span className="nr-wordmark">
      nightreel
      <span className="nr-wordmark__dot" aria-hidden="true" />
    </span>
  )
}

export function TopNav({ links = [], actions }: TopNavProps) {
  return (
    <header className="nr-topnav">
      <div className="nr-topnav__inner">
        <Link to="/" className="nr-topnav__brand" aria-label="Nightreel home">
          <Wordmark />
        </Link>
        {links.length > 0 ? (
          <nav aria-label="Main" className="nr-topnav__nav">
            <ul className="nr-topnav__links">
              {links.map((link) => (
                <li key={String(link.to)}>
                  <Link
                    to={link.to}
                    className="nr-topnav__link"
                    activeProps={{ className: 'nr-topnav__link--active', 'aria-current': 'page' }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {actions ? <div className="nr-topnav__actions">{actions}</div> : null}
      </div>
    </header>
  )
}
