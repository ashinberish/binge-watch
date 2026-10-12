import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Input } from './Input'

describe('Input', () => {
  it('accepts typing and is labelled', async () => {
    const { container } = render(
      <label>
        Email
        <Input type="email" />
      </label>,
    )
    const input = screen.getByLabelText('Email')
    await userEvent.type(input, 'you@example.com')
    expect(input).toHaveValue('you@example.com')
    await expectNoA11yViolations(container)
  })

  it('marks invalid state', () => {
    render(<Input aria-label="Name" invalid />)
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('renders a decorative icon', async () => {
    const { container } = render(<Input aria-label="Search shows" icon="search" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await expectNoA11yViolations(container)
  })
})
