import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations, renderWithProviders } from '@/test/render'
import { installAuthBridge, useSession } from '../session'
import { LoginForm } from './LoginForm'

describe('LoginForm', () => {
  beforeAll(() => installAuthBridge())
  beforeEach(() => useSession.getState().clear())

  it('validates before calling the API', async () => {
    const { container } = renderWithProviders(<LoginForm onSuccess={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(screen.getByText('Enter your password')).toBeInTheDocument()
    await expectNoA11yViolations(container)
  })

  it('signs in and stores the session', async () => {
    const onSuccess = vi.fn()
    renderWithProviders(<LoginForm onSuccess={onSuccess} />)
    await userEvent.type(screen.getByLabelText('Email'), 'kai@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(useSession.getState().accessToken).toBe('access-1')
    expect(localStorage.getItem('nightreel.refresh_token')).toBe('refresh-1')
  })

  it('shows the problem detail on failure', async () => {
    renderWithProviders(<LoginForm onSuccess={() => {}} />)
    await userEvent.type(screen.getByLabelText('Email'), 'kai@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.')
    expect(useSession.getState().accessToken).toBeNull()
  })
})
