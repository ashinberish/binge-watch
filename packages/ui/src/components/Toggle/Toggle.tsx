import { Switch } from 'radix-ui'
import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '../../utils/cn'

export interface ToggleProps extends ComponentProps<typeof Switch.Root> {
  /** Visible label. Without one, pass aria-label. */
  label?: ReactNode
  /** Secondary help text under the label. */
  description?: ReactNode
}

/** On/off switch (Radix Switch). Pill shape is reserved for toggles and chips. */
export function Toggle({ label, description, id, className, ...props }: ToggleProps) {
  const autoId = useId()
  const switchId = id ?? autoId
  const descriptionId = description ? `${switchId}-description` : undefined
  const control = (
    <Switch.Root
      id={switchId}
      className={cn('nr-toggle', !label && className)}
      aria-describedby={descriptionId}
      {...props}
    >
      <Switch.Thumb className="nr-toggle__thumb" />
    </Switch.Root>
  )
  if (!label) return control
  return (
    <div className={cn('nr-toggle-field', className)}>
      <div className="nr-toggle-field__text">
        <label htmlFor={switchId} className="nr-toggle-field__label">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="nr-toggle-field__description">
            {description}
          </p>
        ) : null}
      </div>
      {control}
    </div>
  )
}
