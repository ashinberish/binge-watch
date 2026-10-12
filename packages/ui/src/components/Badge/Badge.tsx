import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../utils/cn'

export const badgeVariants = cva('nr-badge', {
  variants: {
    variant: {
      neutral: 'nr-badge--neutral',
      new: 'nr-badge--new',
      info: 'nr-badge--info',
      danger: 'nr-badge--danger',
    },
  },
  defaultVariants: { variant: 'neutral' },
})

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

/** Short status label in the uppercase caption style. Write the text in sentence case. */
export function Badge({ variant, className, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
