import type { ReactNode } from 'react'
import './FormActions.css'

export interface FormActionsProps {
  children: ReactNode
  align?: 'start' | 'end' | 'stretch'
}

/** Button row at the end of a form. Primary action goes last. */
export function FormActions({ children, align = 'end' }: FormActionsProps) {
  return <div className={`nr-form-actions nr-form-actions--${align}`}>{children}</div>
}
