import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { EmptyState } from '@/components/feedback'

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFound,
})

function NotFound() {
  return (
    <main className="nr-auth">
      <EmptyState
        icon="tv"
        title="This page is not on tonight"
        description="The link may be broken, or the page may have moved."
        action={<Link to="/">Go to Nightreel</Link>}
      />
    </main>
  )
}
