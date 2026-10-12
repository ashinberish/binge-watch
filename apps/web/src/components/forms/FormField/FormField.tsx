import { useId, type ReactNode } from 'react'
import './FormField.css'

export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  invalid: boolean
}

export interface FormFieldProps {
  label: ReactNode
  hint?: ReactNode
  /** Error message; marks the control invalid and is announced with it. */
  error?: string
  /** Render the control, spreading the given props onto it. */
  children: (control: FieldControlProps) => ReactNode
  id?: string
}

/** Label + control + hint/error wiring with correct ids and aria-describedby. */
export function FormField({ label, hint, error, children, id }: FormFieldProps) {
  const autoId = useId()
  const controlId = id ?? autoId
  const hintId = hint ? `${controlId}-hint` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className="nr-field">
      <label htmlFor={controlId} className="nr-field__label">
        {label}
      </label>
      {children({ id: controlId, 'aria-describedby': describedBy, invalid: Boolean(error) })}
      {hint ? (
        <p id={hintId} className="nr-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="nr-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
