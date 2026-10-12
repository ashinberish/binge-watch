import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { useSession } from '../session'
import { RegisterForm } from './RegisterForm'

async function fill(email: string) {
  await userEvent.type(screen.getByLabelText('Your name'), 'Kai')
  await userEvent.type(screen.getByLabelText('Email'), email)
  await userEvent.type(screen.getByLabelText('Password'), 'correct-horse')
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('RegisterForm', () => {
  beforeEach(() => useSession.getState().clear())

  it('creates the account and signs in', async () => {
    const onSuccess = vi.fn()
    const { client } = renderWithProviders(<RegisterForm onSuccess={onSuccess} />)
    await fill('kai@example.com')
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(useSession.getState().accessToken).toBe('access-1')
    expect(client.getQueryData(['me'])).toMatchObject({ display_name: 'Kai' })
  })

  it('surfaces conflicts', async () => {
    renderWithProviders(<RegisterForm onSuccess={() => {}} />)
    await fill('taken@example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with this email already exists.',
    )
  })

  it('requires a long enough password', async () => {
    renderWithProviders(<RegisterForm onSuccess={() => {}} />)
    await userEvent.type(screen.getByLabelText('Password'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Use at least 8 characters')).toBeInTheDocument()
  })
})
