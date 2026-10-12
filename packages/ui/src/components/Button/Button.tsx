import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../utils/cn'
import { Icon, type IconSource } from '../Icon'

export const buttonVariants = cva('nr-button', {
  variants: {
    variant: {
      primary: 'nr-button--primary',
      secondary: 'nr-button--secondary',
      ghost: 'nr-button--ghost',
      danger: 'nr-button--danger',
    },
    size: {
      sm: 'nr-button--sm',
      md: 'nr-button--md',
    },
    fullWidth: {
      true: 'nr-button--full',
      false: null,
    },
  },
  defaultVariants: { variant: 'primary', size: 'md', fullWidth: false },
})

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Leading icon (name or lucide component). */
  icon?: IconSource
  /** Trailing icon (name or lucide component). */
  iconRight?: IconSource
  /** Shows a spinner, sets aria-busy and blocks interaction. */
  loading?: boolean
}

export function Button({
  variant,
  size,
  fullWidth,
  icon,
  iconRight,
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const iconSize = size === 'sm' ? 16 : 20
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...props}
    >
      {loading ? (
        <Icon icon="loader" size={iconSize} className="nr-button__spinner" />
      ) : icon ? (
        <Icon icon={icon} size={iconSize} />
      ) : null}
      <span className="nr-button__label">{children}</span>
      {iconRight && !loading ? <Icon icon={iconRight} size={iconSize} /> : null}
    </button>
  )
}
