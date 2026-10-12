import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Progress } from './Progress'

describe('Progress', () => {
  it('exposes progressbar semantics', async () => {
    const { container } = render(
      <Progress value={0.625} label="Episode progress" valueText="18 min left" />,
    )
    const bar = screen.getByRole('progressbar', { name: 'Episode progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '63')
    expect(bar).toHaveAttribute('aria-valuetext', '18 min left')
    await expectNoA11yViolations(container)
  })

  it('clamps out-of-range values', () => {
    render(<Progress value={4} label="Done" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })
})
