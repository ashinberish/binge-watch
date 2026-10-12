import { useCallback, useEffect, useState, type DependencyList } from 'react'

export type AsyncState<T> =
  | { status: 'loading'; data?: undefined }
  | { status: 'done'; data: T }
  | { status: 'error'; data?: undefined }

/**
 * Loads `load()` on mount and whenever `deps` change; `reload()` runs it again.
 * Used by extension pages to ask the service worker for data.
 */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    load().then(
      (data) => live && setState({ status: 'done', data }),
      () => live && setState({ status: 'error' }),
    )
    return () => {
      live = false
    }
    // The caller owns the deps, like useEffect.
  }, [...deps, version])

  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return [state, reload] as const
}
