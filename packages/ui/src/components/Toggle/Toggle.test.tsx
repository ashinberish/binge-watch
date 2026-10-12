import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Toggle } from './Toggle'

describe('Toggle', () => {
  it('toggles via its visible label', async () => {
    const onCheckedChange = vi.fn()
    const { container } = render(
      <Toggle
        label="Autoplay next episode"
        description="Starts the next episode after the countdown."
        onCheckedChange={onCheckedChange}
      />,
    )
    const toggle = screen.getByRole('switch', { name: 'Autoplay next episode' })
    expect(toggle).toHaveAccessibleDescription('Starts the next episode after the countdown.')
    expect(toggle).not.toBeChecked()
    await userEvent.click(screen.getByText('Autoplay next episode'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
    expect(toggle).toBeChecked()
    await expectNoA11yViolations(container)
  })

  it('works with aria-label only', async () => {
    const { container } = render(<Toggle aria-label="Skip intros" defaultChecked />)
    expect(screen.getByRole('switch', { name: 'Skip intros' })).toBeChecked()
    await expectNoA11yViolations(container)
  })
})
