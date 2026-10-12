import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { cn } from '../../utils/cn'

interface TileOwnProps {
  /** Show title. Used as the accessible name and as the fallback when there is no art. */
  title: string
  /** 16:9 artwork URL. Without it the title is drawn in the tile-title style. */
  art?: string | null
  /** Meta line under the art, e.g. "S2 · E5 · 18 min left". */
  meta?: ReactNode
  /** Fraction watched, 0–1. Draws the brand progress bar along the bottom edge. */
  progress?: number | null
  /** Optional overlay, e.g. a "New episode" badge. */
  badge?: ReactNode
  className?: string
  style?: CSSProperties
}

export type TileLinkProps = TileOwnProps &
  Omit<ComponentProps<'a'>, keyof TileOwnProps | 'children'> & { href: string }

export type TileButtonProps = TileOwnProps &
  Omit<ComponentProps<'button'>, keyof TileOwnProps | 'children'> & { href?: undefined }

export type TileProps = TileLinkProps | TileButtonProps

function TileInner({ title, art, meta, progress, badge }: TileOwnProps) {
  const ratio =
    progress == null || !Number.isFinite(progress) ? null : Math.min(1, Math.max(0, progress))
  return (
    <>
      <span className="nr-tile__frame">
        {art ? (
          <img className="nr-tile__art" src={art} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="nr-tile__fallback" aria-hidden="true">
            {title}
          </span>
        )}
        {badge ? <span className="nr-tile__badge">{badge}</span> : null}
        {ratio != null ? (
          <span className="nr-tile__progress" aria-hidden="true">
            <span className="nr-tile__progress-fill" style={{ transform: `scaleX(${ratio})` }} />
          </span>
        ) : null}
      </span>
      <span className="nr-tile__body">
        <span className="nr-tile__title nr-visually-hidden">{title}</span>{' '}
        {meta ? <span className="nr-tile__meta">{meta}</span> : null}
      </span>
    </>
  )
}

/** 16:9 title tile. Renders a link when `href` is set, otherwise a button. */
export function Tile(props: TileProps) {
  const { title, art, meta, progress, badge, className, ...rest } = props
  const inner = <TileInner title={title} art={art} meta={meta} progress={progress} badge={badge} />
  if (rest.href !== undefined) {
    const linkProps = rest as Omit<TileLinkProps, keyof TileOwnProps>
    return (
      <a className={cn('nr-tile', className)} {...linkProps}>
        {inner}
      </a>
    )
  }
  const { type = 'button', ...buttonProps } = rest as Omit<TileButtonProps, keyof TileOwnProps>
  return (
    <button type={type} className={cn('nr-tile', className)} {...buttonProps}>
      {inner}
    </button>
  )
}
