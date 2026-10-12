import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  it('checks via its label', async () => {
    const onCheckedChange = vi.fn()
    const { container } = render(
      <Checkbox label="Kids profile" onCheckedChange={onCheckedChange} />,
    )
    const box = screen.getByRole('checkbox', { name: 'Kids profile' })
    await userEvent.click(screen.getByText('Kids profile'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
    expect(box).toBeChecked()
    await expectNoA11yViolations(container)
  })

  it('supports disabled state', () => {
    render(<Checkbox aria-label="Remember me" disabled />)
    expect(screen.getByRole('checkbox', { name: 'Remember me' })).toBeDisabled()
  })
})
