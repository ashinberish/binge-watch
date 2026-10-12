import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Avatar, avatarInitials, readableTextOn } from './Avatar'

describe('Avatar', () => {
  it('shows initials with the name as accessible label', async () => {
    const { container } = render(<Avatar name="Ana Lopez" color="#d32f23" />)
    const avatar = screen.getByRole('img', { name: 'Ana Lopez' })
    expect(avatar).toHaveTextContent('AL')
    await expectNoA11yViolations(container)
  })

  it('can be decorative', () => {
    const { container } = render(<Avatar name="Kai" decorative />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('computes initials and readable text colour', () => {
    expect(avatarInitials('kai')).toBe('K')
    expect(avatarInitials('  ')).toBe('?')
    expect(readableTextOn('#f5b841')).toBe('#1a1206')
    expect(readableTextOn('#141416')).toBe('#ffffff')
  })
})
