import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Button } from './Button'

describe('Button', () => {
  it('renders a primary button by default and handles clicks', async () => {
    const onClick = vi.fn()
    const { container } = render(
      <Button icon="play" onClick={onClick}>
        Resume
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Resume' })
    expect(button).toHaveClass('nr-button', 'nr-button--primary', 'nr-button--md')
    expect(button).toHaveAttribute('type', 'button')
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
    await expectNoA11yViolations(container)
  })

  it('applies variant and size classes', () => {
    render(
      <Button variant="secondary" size="sm">
        Add to list
      </Button>,
    )
    expect(screen.getByRole('button')).toHaveClass('nr-button--secondary', 'nr-button--sm')
  })

  it('is busy and disabled while loading', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Play
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Play' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('forwards ref as a prop', () => {
    let node: HTMLButtonElement | null = null
    render(<Button ref={(el) => void (node = el)}>Play</Button>)
    expect(node).toBeInstanceOf(HTMLButtonElement)
  })
})
