import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../utils/cn'
import { Icon, type IconSource } from '../Icon'

export const inputVariants = cva('nr-input', {
  variants: {
    size: { sm: 'nr-input--sm', md: 'nr-input--md' },
  },
  defaultVariants: { size: 'md' },
})

export interface InputProps
  extends Omit<ComponentProps<'input'>, 'size'>, VariantProps<typeof inputVariants> {
  /** Marks the field invalid (sets aria-invalid). Pair with an error message via aria-describedby. */
  invalid?: boolean
  /** Decorative leading icon, e.g. `search`. */
  icon?: IconSource
}

export function Input({ size, invalid, icon, className, ...props }: InputProps) {
  const input = (
    <input
      className={cn(inputVariants({ size }), icon && 'nr-input--with-icon', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  )
  if (!icon) return input
  return (
    <span className="nr-input-wrap">
      <Icon icon={icon} size={size === 'sm' ? 16 : 20} className="nr-input-wrap__icon" />
      {input}
    </span>
  )
}
