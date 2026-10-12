import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '../../utils/cn'
import { Icon } from '../Icon'

export interface CheckboxProps extends ComponentProps<typeof CheckboxPrimitive.Root> {
  /** Visible label. Without one, pass aria-label. */
  label?: ReactNode
}

export function Checkbox({ label, id, className, ...props }: CheckboxProps) {
  const autoId = useId()
  const boxId = id ?? autoId
  const box = (
    <CheckboxPrimitive.Root
      id={boxId}
      className={cn('nr-checkbox', !label && className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="nr-checkbox__indicator">
        <Icon
          icon={props.checked === 'indeterminate' ? 'x' : 'check'}
          size={16}
          strokeWidth={2.5}
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
  if (!label) return box
  return (
    <div className={cn('nr-checkbox-field', className)}>
      {box}
      <label htmlFor={boxId} className="nr-checkbox-field__label">
        {label}
      </label>
    </div>
  )
}
