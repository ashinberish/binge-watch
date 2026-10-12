import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { API, problem } from '@/test/fixtures'
import { expectNoA11yViolations, renderWithRouter } from '@/test/render'
import { server } from '@/test/server'
import { ConnectExtensionCard } from './ConnectExtensionCard'

const REDIRECT = `https://${'abcdefghijklmnop'.repeat(2)}.chromiumapp.org/`

describe('ConnectExtensionCard', () => {
  it('creates a code and hands it back to the extension in the fragment', async () => {
    let body: unknown
    server.use(
      http.post(`${API}/auth/extension-code`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ code: 'a+b/c', expires_in: 60 }, { status: 201 })
      }),
    )
    const onRedirect = vi.fn()
    const { container } = await renderWithRouter(
      <ConnectExtensionCard redirectUri={REDIRECT} displayName="Kai" onRedirect={onRedirect} />,
    )
    expect(
      screen.getByRole('heading', { name: 'Connect the Nightreel extension' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Signed in as Kai.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/history')
    await expectNoA11yViolations(container)

    await userEvent.click(screen.getByRole('button', { name: 'Connect extension' }))
    await vi.waitFor(() => expect(onRedirect).toHaveBeenCalledOnce())
    expect(body).toEqual({ redirect_uri: REDIRECT })
    expect(onRedirect).toHaveBeenCalledWith(`${REDIRECT}#code=a%2Bb%2Fc`)
  })

  it('shows the error and stays put when the code cannot be created', async () => {
    server.use(
      http.post(`${API}/auth/extension-code`, () =>
        HttpResponse.json(problem(422, 'Unprocessable', 'That redirect is not allowed.'), {
          status: 422,
        }),
      ),
    )
    const onRedirect = vi.fn()
    await renderWithRouter(
      <ConnectExtensionCard redirectUri={REDIRECT} displayName="Kai" onRedirect={onRedirect} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Connect extension' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That redirect is not allowed.')
    expect(onRedirect).not.toHaveBeenCalled()
  })

  it.each([
    undefined,
    'https://evil.example/',
    'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org.evil.example/',
    'http://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/',
    'https://abcdefghijklmnopabcdefghijklmnoz.chromiumapp.org/',
    'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org:8443/',
    `${REDIRECT}#code=planted`,
  ])('refuses an invalid redirect_uri (%s) without calling the API', async (redirectUri) => {
    let called = false
    server.use(
      http.post(`${API}/auth/extension-code`, () => {
        called = true
        return HttpResponse.json({ code: 'x', expires_in: 60 }, { status: 201 })
      }),
    )
    const onRedirect = vi.fn()
    const { container } = await renderWithRouter(
      <ConnectExtensionCard redirectUri={redirectUri} displayName="Kai" onRedirect={onRedirect} />,
    )
    expect(
      screen.getByRole('heading', { name: 'This link cannot connect the extension' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect extension' })).not.toBeInTheDocument()
    expect(called).toBe(false)
    expect(onRedirect).not.toHaveBeenCalled()
    await expectNoA11yViolations(container)
  })
})
