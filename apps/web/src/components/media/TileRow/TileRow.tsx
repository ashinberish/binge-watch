import { IconButton, Skeleton } from '@nightreel/ui'
import { Children, useId, useRef, type ReactNode } from 'react'
import './TileRow.css'

export interface TileRowProps {
  title: string
  children?: ReactNode
  /** Shows skeleton tiles instead of children. */
  loading?: boolean
  skeletonCount?: number
  /** Rendered when not loading and there are no children. */
  empty?: ReactNode
}

/** Horizontally scrolling row of 16:9 tiles with a heading. */
export function TileRow({
  title,
  children,
  loading = false,
  skeletonCount = 4,
  empty,
}: TileRowProps) {
  const headingId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  const items = Children.toArray(children)

  const scrollBy = (direction: 1 | -1) => {
    const list = listRef.current
    if (!list) return
    list.scrollBy({ left: direction * list.clientWidth * 0.9, behavior: 'smooth' })
  }

  let body: ReactNode
  if (loading) {
    body = (
      <div
        className="nr-tile-row__list"
        role="status"
        aria-label={`Loading ${title.toLowerCase()}`}
      >
        {Array.from({ length: skeletonCount }, (_, i) => (
          <Skeleton key={i} shape="tile" />
        ))}
      </div>
    )
  } else if (items.length === 0) {
    body = empty ?? null
  } else {
    body = (
      <ul ref={listRef} className="nr-tile-row__list">
        {items.map((child, i) => (
          <li key={i} className="nr-tile-row__item">
            {child}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className="nr-tile-row" aria-labelledby={headingId}>
      <div className="nr-tile-row__header">
        <h2 id={headingId} className="nr-tile-row__title">
          {title}
        </h2>
        {!loading && items.length > 1 ? (
          <div className="nr-tile-row__controls">
            <IconButton
              icon="chevron-left"
              size="sm"
              aria-label={`Scroll ${title.toLowerCase()} left`}
              onClick={() => scrollBy(-1)}
            />
            <IconButton
              icon="chevron-right"
              size="sm"
              aria-label={`Scroll ${title.toLowerCase()} right`}
              onClick={() => scrollBy(1)}
            />
          </div>
        ) : null}
      </div>
      {body}
    </section>
  )
}
