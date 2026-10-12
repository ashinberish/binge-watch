import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../utils/cn'
import { Icon, type IconSource } from '../Icon'

export const iconButtonVariants = cva('nr-icon-button', {
  variants: {
    variant: {
      primary: 'nr-icon-button--primary',
      secondary: 'nr-icon-button--secondary',
      ghost: 'nr-icon-button--ghost',
    },
    size: { sm: 'nr-icon-button--sm', md: 'nr-icon-button--md' },
  },
  defaultVariants: { variant: 'ghost', size: 'md' },
})

export interface IconButtonProps
  extends
    Omit<ComponentProps<'button'>, 'children' | 'aria-label'>,
    VariantProps<typeof iconButtonVariants> {
  icon: IconSource
  /** Required: icon-only controls must have an accessible name. */
  'aria-label': string
}

export function IconButton({
  icon,
  variant,
  size,
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button type={type} className={cn(iconButtonVariants({ variant, size }), className)} {...props}>
      <Icon icon={icon} size={size === 'sm' ? 16 : 20} />
    </button>
  )
}
