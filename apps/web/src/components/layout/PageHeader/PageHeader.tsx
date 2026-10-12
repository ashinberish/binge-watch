import type { ReactNode } from 'react'
import './PageHeader.css'

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Use the display style (Archivo Narrow) for hero-like pages. */
  display?: boolean
}

export function PageHeader({ title, description, actions, display = false }: PageHeaderProps) {
  return (
    <div className="nr-page-header">
      <div className="nr-page-header__text">
        <h1 className={display ? 'nr-page-header__title--display' : 'nr-page-header__title'}>
          {title}
        </h1>
        {description ? <p className="nr-page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="nr-page-header__actions">{actions}</div> : null}
    </div>
  )
}
