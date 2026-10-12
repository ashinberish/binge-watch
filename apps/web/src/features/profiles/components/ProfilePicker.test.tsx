import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { API, profiles } from '@/test/fixtures'
import { expectNoA11yViolations, renderWithProviders } from '@/test/render'
import { server } from '@/test/server'
import { ProfilePicker } from './ProfilePicker'

describe('ProfilePicker', () => {
  it('lists profiles and selects one', async () => {
    const onSelect = vi.fn()
    const { container } = renderWithProviders(<ProfilePicker onSelect={onSelect} />)
    const kai = await screen.findByRole('button', { name: 'Kai' })
    expect(screen.getByRole('button', { name: /Mo Reyes/ })).toHaveTextContent('Kids')
    await expectNoA11yViolations(container)
    await userEvent.click(kai)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'p_1' }))
  })

  it('offers to create the first profile for new accounts', async () => {
    server.use(http.get(`${API}/profiles`, () => HttpResponse.json([])))
    const onSelect = vi.fn()
    renderWithProviders(<ProfilePicker onSelect={onSelect} />)
    expect(
      await screen.findByRole('heading', { name: 'Create your first profile' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add profile' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a profile' })
    await userEvent.type(within(dialog).getByLabelText('Profile name'), 'Ana')
    await userEvent.click(within(dialog).getByLabelText('Kids profile'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add profile' }))
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Ana', is_kids: true }),
      ),
    )
  })

  it('hides "Add profile" at the limit', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      ...profiles[0],
      id: `p_${i}`,
      name: `Viewer ${i}`,
    }))
    server.use(http.get(`${API}/profiles`, () => HttpResponse.json(five)))
    renderWithProviders(<ProfilePicker onSelect={() => {}} />)
    expect(await screen.findByText('You have the maximum of 5 profiles.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add profile' })).not.toBeInTheDocument()
  })

  it('tolerates profiles without optional fields', async () => {
    server.use(
      http.get(`${API}/profiles`, () =>
        HttpResponse.json([{ id: 'p_9', name: 'Sam', created_at: '2026-01-01T00:00:00Z' }]),
      ),
    )
    renderWithProviders(<ProfilePicker onSelect={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Sam' })).not.toHaveTextContent('Kids')
  })
})
