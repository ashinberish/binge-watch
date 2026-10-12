import { Select as SelectPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '../../utils/cn'
import { Icon } from '../Icon'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<ComponentProps<typeof SelectPrimitive.Root>, 'children'> {
  options: SelectOption[]
  placeholder?: string
  id?: string
  className?: string
  size?: 'sm' | 'md'
  invalid?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/** Single-value select built on Radix Select. */
export function Select({
  options,
  placeholder,
  id,
  className,
  size = 'md',
  invalid,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...rootProps
}: SelectProps) {
  return (
    <SelectPrimitive.Root {...rootProps}>
      <SelectPrimitive.Trigger
        id={id}
        className={cn('nr-select__trigger', size === 'sm' && 'nr-select__trigger--sm', className)}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid || undefined}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="nr-select__chevron">
          <Icon icon="chevron-down" size={16} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="nr-select__content" position="popper" sideOffset={4}>
          <SelectPrimitive.Viewport className="nr-select__viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="nr-select__item"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="nr-select__indicator">
                  <Icon icon="check" size={16} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
