import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { API, party } from '@/test/fixtures'
import { expectNoA11yViolations, renderWithRouter } from '@/test/render'
import { server } from '@/test/server'
import { PartyInviteCard } from './PartyInviteCard'

const LINK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ#nightreel-party=K7xQ2m'

describe('PartyInviteCard', () => {
  it('shows who invited you, joins, then opens the video with the invite', async () => {
    let joined = false
    server.use(
      http.post(`${API}/parties/:code/join`, ({ params }) => {
        joined = params.code === 'K7xQ2m'
        return HttpResponse.json({ ...party, member_count: 3 })
      }),
    )
    const onOpen = vi.fn()
    const { container } = await renderWithRouter(<PartyInviteCard code="K7xQ2m" onOpen={onOpen} />)
    expect(
      await screen.findByRole('heading', { name: 'Mo invited you to a watch party' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Watching on YouTube')).toBeInTheDocument()
    expect(
      screen.getByText('You need the Nightreel extension for Chrome to sync playback.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Not now' })).toHaveAttribute('href', '/history')
    await expectNoA11yViolations(container)

    await userEvent.click(screen.getByRole('button', { name: 'Join and open' }))
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledOnce())
    expect(joined).toBe(true)
    expect(onOpen).toHaveBeenCalledWith(LINK)
  })

  it('says so when the party has ended or the link is wrong', async () => {
    const { container } = await renderWithRouter(<PartyInviteCard code="ended" />)
    expect(
      await screen.findByRole('heading', { name: 'This party has ended or the link is wrong.' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join and open' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Nightreel' })).toBeInTheDocument()
    await expectNoA11yViolations(container)
  })

  it('says so when the party is full, and stays put', async () => {
    const onOpen = vi.fn()
    const { container } = await renderWithRouter(<PartyInviteCard code="full" onOpen={onOpen} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Join and open' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This party is full.')
    expect(onOpen).not.toHaveBeenCalled()
    await expectNoA11yViolations(container)
  })

  it('says the party ended when it ends between loading and joining', async () => {
    server.use(
      http.post(`${API}/parties/:code/join`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Not Found', status: 404 },
          { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    )
    await renderWithRouter(<PartyInviteCard code="K7xQ2m" onOpen={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Join and open' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This party has ended or the link is wrong.',
    )
  })

  it.each(['http://www.youtube.com/watch?v=x', 'javascript:alert(1)', 'not a url'])(
    'never opens a watch URL that is not https (%s)',
    async (watchUrl) => {
      server.use(
        http.get(`${API}/parties/:code`, () =>
          HttpResponse.json({ ...party, watch_url: watchUrl }),
        ),
      )
      const onOpen = vi.fn()
      await renderWithRouter(<PartyInviteCard code="K7xQ2m" onOpen={onOpen} />)
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This party’s video link cannot be opened.',
      )
      expect(screen.queryByRole('button', { name: 'Join and open' })).not.toBeInTheDocument()
      expect(onOpen).not.toHaveBeenCalled()
    },
  )

  it('shows a loading state while the invite loads', async () => {
    server.use(http.get(`${API}/parties/:code`, () => new Promise<never>(() => {})))
    await renderWithRouter(<PartyInviteCard code="K7xQ2m" />)
    expect(screen.getByLabelText('Loading the invite')).toHaveAttribute('aria-busy', 'true')
  })
})
