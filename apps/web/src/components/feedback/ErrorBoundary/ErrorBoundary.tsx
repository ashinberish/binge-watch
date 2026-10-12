import { Button } from '@nightreel/ui'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { EmptyState } from '../EmptyState'

export interface ErrorFallbackProps {
  error?: unknown
  onRetry?: () => void
  title?: string
}

/** Shared fallback for render errors and failed route loads. */
export function ErrorFallback({ onRetry, title = 'Something went wrong' }: ErrorFallbackProps) {
  return (
    <div role="alert">
      <EmptyState
        icon="triangle-alert"
        title={title}
        description="This part of Nightreel did not load. Try again, and if it keeps happening, reload the page."
        action={
          onRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          ) : undefined
        }
      />
    </div>
  )
}

export interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: (props: { error: unknown; reset: () => void }) => ReactNode
  onError?: (error: unknown, info: ErrorInfo) => void
}

interface State {
  error: unknown
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null, hasError: false }

  static getDerivedStateFromError(error: unknown): State {
    return { error, hasError: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info)
  }

  reset = (): void => {
    this.setState({ error: null, hasError: false })
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    if (this.props.fallback)
      return this.props.fallback({ error: this.state.error, reset: this.reset })
    return <ErrorFallback error={this.state.error} onRetry={this.reset} />
  }
}
