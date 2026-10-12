import { Icon, type IconSource } from '@nightreel/ui'
import type { ReactNode } from 'react'
import './EmptyState.css'

export interface EmptyStateProps {
  title: string
  description?: ReactNode
  icon?: IconSource
  action?: ReactNode
  /** Heading level of the title. */
  headingLevel?: 2 | 3
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  headingLevel = 2,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <div className="nr-empty">
      {icon ? (
        <span className="nr-empty__icon">
          <Icon icon={icon} size={32} />
        </span>
      ) : null}
      <Heading className="nr-empty__title">{title}</Heading>
      {description ? <p className="nr-empty__description">{description}</p> : null}
      {action ? <div className="nr-empty__action">{action}</div> : null}
    </div>
  )
}
