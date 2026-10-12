import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { IconButton } from './IconButton'

describe('IconButton', () => {
  it('uses aria-label as its accessible name', async () => {
    const onClick = vi.fn()
    const { container } = render(<IconButton icon="x" aria-label="Close" onClick={onClick} />)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClick).toHaveBeenCalledOnce()
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await expectNoA11yViolations(container)
  })

  it('applies size classes', () => {
    render(<IconButton icon="settings" aria-label="Settings" size="sm" variant="secondary" />)
    expect(screen.getByRole('button')).toHaveClass(
      'nr-icon-button--sm',
      'nr-icon-button--secondary',
    )
  })
})
