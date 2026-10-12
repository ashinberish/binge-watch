import { ToastProvider } from '@nightreel/ui'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { useEffect } from 'react'
import { queryClient } from '@/lib/query-client'
import { useUiStore } from '@/stores/ui'
import { router } from './router'

/** Mirrors the preferred theme onto <html> so portals (dialogs, menus, toasts) match. */
function ThemeSync() {
  const theme = useUiStore((s) => s.theme)
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])
  return null
}

export function AppProviders() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ThemeSync />
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  )
}
