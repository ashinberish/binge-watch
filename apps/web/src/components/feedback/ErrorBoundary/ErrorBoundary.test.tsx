import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error('boom')
  return <p>All good</p>
}

function Harness() {
  const [explode, setExplode] = useState(true)
  return (
    <ErrorBoundary onError={() => setExplode(false)}>
      <Bomb explode={explode} />
    </ErrorBoundary>
  )
}

describe('ErrorBoundary', () => {
  it('shows the fallback and recovers on retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Harness />)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('All good')).toBeInTheDocument()
  })
})
