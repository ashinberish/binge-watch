import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { API, user } from '@/test/fixtures'
import { expectNoA11yViolations, renderWithProviders } from '@/test/render'
import { server } from '@/test/server'
import { DisplayNameForm } from './DisplayNameForm'

describe('DisplayNameForm', () => {
  it('saves a new display name', async () => {
    let sent: unknown
    server.use(
      http.patch(`${API}/users/me`, async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ ...user, display_name: 'Kai L' })
      }),
    )
    const { container, client } = renderWithProviders(<DisplayNameForm displayName="Kai" />)
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    await expectNoA11yViolations(container)
    const input = screen.getByLabelText('Display name')
    await userEvent.clear(input)
    await userEvent.type(input, 'Kai L')
    await userEvent.click(save)
    expect(await screen.findByText('Name updated')).toBeInTheDocument()
    expect(sent).toEqual({ display_name: 'Kai L' })
    expect(client.getQueryData(['me'])).toMatchObject({ display_name: 'Kai L' })
  })

  it('rejects an empty name', async () => {
    renderWithProviders(<DisplayNameForm displayName="Kai" />)
    await userEvent.clear(screen.getByLabelText('Display name'))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Enter your name')).toBeInTheDocument()
  })
})
