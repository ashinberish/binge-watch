import { render, screen } from '@testing-library/react'
import { Popcorn } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Icon } from './Icon'

describe('Icon', () => {
  it('is decorative by default', async () => {
    const { container } = render(<Icon icon="play" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('width', '20')
    expect(svg).toHaveAttribute('stroke-width', '1.75')
    await expectNoA11yViolations(container)
  })

  it('accepts a component and a label', () => {
    render(<Icon icon={Popcorn} size="extension" label="Snacks" />)
    const svg = screen.getByRole('img', { name: 'Snacks' })
    expect(svg).toHaveAttribute('width', '16')
  })
})
