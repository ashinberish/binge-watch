import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { API } from '@/test/fixtures'
import { expectNoA11yViolations, renderWithProviders } from '@/test/render'
import { server } from '@/test/server'
import { ContinueWatchingRow } from './ContinueWatchingRow'

describe('ContinueWatchingRow', () => {
  it('renders a tile per in-progress episode', async () => {
    const onResume = vi.fn()
    let profileParam: string | null = null
    server.use(
      http.get(`${API}/history/continue-watching`, ({ request }) => {
        profileParam = new URL(request.url).searchParams.get('profile_id')
        return HttpResponse.json([
          {
            episode_id: 'e_1',
            show_id: 's_1',
            show_title: 'Night Shift',
            poster_url: null,
            season_number: 2,
            episode_number: 5,
            episode_title: 'Lights out',
            position_seconds: 1800,
            duration_seconds: 2880,
            updated_at: '2026-10-11T21:00:00Z',
          },
        ])
      }),
    )
    const { container } = renderWithProviders(
      <ContinueWatchingRow profileId="p_1" onResume={onResume} />,
    )
    const tile = await screen.findByRole('button', { name: 'Resume Night Shift' })
    expect(tile).toHaveTextContent('S2 · E5 · 18 min left')
    expect(profileParam).toBe('p_1')
    await expectNoA11yViolations(container)
    await userEvent.click(tile)
    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ episode_id: 'e_1' }))
  })

  it('shows an empty state', async () => {
    server.use(http.get(`${API}/history/continue-watching`, () => HttpResponse.json([])))
    renderWithProviders(<ContinueWatchingRow profileId="p_1" />)
    expect(await screen.findByRole('heading', { name: 'Nothing in progress' })).toBeInTheDocument()
  })
})
