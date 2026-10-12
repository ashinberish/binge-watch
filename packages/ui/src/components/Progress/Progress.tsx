import type { ComponentProps } from 'react'
import { cn } from '../../utils/cn'

export interface ProgressProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Fraction complete, 0–1. Values outside are clamped. */
  value: number
  /** Accessible name, e.g. "Episode progress". Required unless aria-labelledby is set. */
  label?: string
  /** Human readable value, e.g. "18 min left". Defaults to the percentage. */
  valueText?: string
  size?: 'sm' | 'md'
}

export function Progress({
  value,
  label,
  valueText,
  size = 'md',
  className,
  style,
  ...props
}: ProgressProps) {
  const ratio = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  const percent = Math.round(ratio * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText ?? `${percent}%`}
      className={cn('nr-progress', size === 'sm' && 'nr-progress--sm', className)}
      style={style}
      {...props}
    >
      <div className="nr-progress__fill" style={{ transform: `scaleX(${ratio})` }} />
    </div>
  )
}
