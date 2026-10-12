import type { CSSProperties, ComponentProps } from 'react'
import { cn } from '../../utils/cn'

export interface SkeletonProps extends ComponentProps<'span'> {
  shape?: 'text' | 'rect' | 'circle' | 'tile'
  width?: CSSProperties['width']
  height?: CSSProperties['height']
}

/** Loading placeholder. Hidden from assistive tech; announce loading on the container (aria-busy). */
export function Skeleton({
  shape = 'rect',
  width,
  height,
  className,
  style,
  ...props
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('nr-skeleton', `nr-skeleton--${shape}`, className)}
      style={{ width, height, ...style }}
      {...props}
    />
  )
}
