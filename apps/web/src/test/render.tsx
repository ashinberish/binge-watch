import { ToastProvider } from '@nightreel/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, waitFor, type RenderResult } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import type { ReactElement, ReactNode } from 'react'
import { expect } from 'vitest'

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  })
}

export function Providers({ children, client }: { children: ReactNode; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
}

/** Render with a fresh QueryClient and the toast provider. */
export function renderWithProviders(
  ui: ReactElement,
  client: QueryClient = createTestQueryClient(),
): RenderResult & { client: QueryClient } {
  return { ...render(<Providers client={client}>{ui}</Providers>), client }
}

/** Render inside a throwaway memory router so <Link> works. */
export async function renderWithRouter(
  ui: ReactElement,
  { path = '/', client = createTestQueryClient() }: { path?: string; client?: QueryClient } = {},
): Promise<RenderResult & { client: QueryClient }> {
  const rootRoute = createRootRoute({ component: () => ui })
  const splat = createRoute({ getParentRoute: () => rootRoute, path: '$' })
  const router = createRouter({
    routeTree: rootRoute.addChildren([splat]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const result = render(
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>,
  )
  await waitFor(() => expect(router.state.status).toBe('idle'))
  return { ...result, client }
}

const axe = configureAxe({
  rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
})

export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe(container)
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
    ),
  ).toEqual([])
}
