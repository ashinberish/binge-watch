import type { Theme } from '@nightreel/ui'
import { createRouter } from '@tanstack/react-router'
import { ErrorFallback } from '@/components/feedback'
import { queryClient } from '@/lib/query-client'
import { routeTree } from './routeTree.gen'

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  // Let TanStack Query own caching for preloaded data.
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  defaultErrorComponent: ({ error, reset }) => <ErrorFallback error={error} onRetry={reset} />,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
  interface StaticDataRouteOption {
    /** Force a theme for this page (account pages use light). */
    theme?: Theme
  }
}
