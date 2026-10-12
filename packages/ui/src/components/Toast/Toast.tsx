import { Toast as ToastPrimitive } from 'radix-ui'
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../utils/cn'
import { Button } from '../Button'
import { IconButton } from '../IconButton'

export type ToastVariant = 'neutral' | 'success' | 'danger'

export interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  /** Milliseconds before auto-dismiss. */
  duration?: number
  action?: { label: string; onClick: () => void; altText?: string }
}

interface ToastItem extends ToastOptions {
  id: string
  open: boolean
}

export interface ToastApi {
  toast: (options: ToastOptions) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export interface ToastProviderProps {
  children: ReactNode
  /** Default auto-dismiss in ms. */
  duration?: number
  /** Landmark label for the toast region. */
  label?: string
}

export function ToastProvider({
  children,
  duration = 5000,
  label = 'Notifications',
}: ToastProviderProps) {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: string) => {
    setItems((all) => all.map((t) => (t.id === id ? { ...t, open: false } : t)))
    // Leave time for the exit animation before unmounting.
    setTimeout(() => setItems((all) => all.filter((t) => t.id !== id)), 300)
  }, [])

  const toast = useCallback((options: ToastOptions) => {
    counter.current += 1
    const id = `nr-toast-${counter.current}`
    setItems((all) => [...all, { ...options, id, open: true }])
    return id
  }, [])

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastPrimitive.Provider duration={duration} swipeDirection="right" label={label}>
      <ToastContext value={api}>{children}</ToastContext>
      {items.map((item) => (
        <ToastPrimitive.Root
          key={item.id}
          open={item.open}
          onOpenChange={(open) => {
            if (!open) dismiss(item.id)
          }}
          duration={item.duration}
          type={item.variant === 'danger' ? 'foreground' : 'background'}
          className={cn('nr-toast', `nr-toast--${item.variant ?? 'neutral'}`)}
        >
          <div className="nr-toast__text">
            <ToastPrimitive.Title className="nr-toast__title">{item.title}</ToastPrimitive.Title>
            {item.description ? (
              <ToastPrimitive.Description className="nr-toast__description">
                {item.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          {item.action ? (
            <ToastPrimitive.Action altText={item.action.altText ?? item.action.label} asChild>
              <Button size="sm" variant="secondary" onClick={item.action.onClick}>
                {item.action.label}
              </Button>
            </ToastPrimitive.Action>
          ) : null}
          <ToastPrimitive.Close asChild>
            <IconButton icon="x" size="sm" aria-label="Dismiss" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="nr-toast-viewport" />
    </ToastPrimitive.Provider>
  )
}

/** Access the toast API. Must be used inside <ToastProvider>. */
export function useToast(): ToastApi {
  const ctx = use(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
