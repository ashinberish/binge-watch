import { ToastProvider } from '@nightreel/ui'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installAuthBridge, useSession } from '@/features/auth'
import { createTestQueryClient } from '@/test/render'
import { routeTree } from './routeTree.gen'

function renderApp(path: string) {
  const queryClient = createTestQueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return router
}

describe('/party/$code', () => {
  beforeAll(() => installAuthBridge())
  beforeEach(() => {
    useSession.getState().clear()
    // The router restores scroll on navigation; jsdom has no scrolling.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })

  it('sends a signed-out viewer through sign in and back to the invite', async () => {
    const router = renderApp('/party/K7xQ2m')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toEqual({ redirect: '/party/K7xQ2m' })

    await userEvent.type(screen.getByLabelText('Email'), 'kai@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(
      await screen.findByRole('heading', { name: 'Mo invited you to a watch party' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/party/K7xQ2m')
  })
})
