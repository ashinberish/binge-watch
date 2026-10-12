import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Tile } from './Tile'

describe('Tile', () => {
  it('renders a button with the title fallback and meta', async () => {
    const onClick = vi.fn()
    const { container } = render(
      <Tile title="Night Shift" meta="S2 · E5 · 18 min left" progress={0.6} onClick={onClick} />,
    )
    const tile = screen.getByRole('button', { name: /Night Shift/ })
    expect(tile).toHaveAccessibleName('Night Shift S2 · E5 · 18 min left')
    expect(container.querySelector('.nr-tile__fallback')).toHaveTextContent('Night Shift')
    expect(container.querySelector('.nr-tile__progress-fill')).toHaveStyle({
      transform: 'scaleX(0.6)',
    })
    await userEvent.click(tile)
    expect(onClick).toHaveBeenCalledOnce()
    await expectNoA11yViolations(container)
  })

  it('renders a link with decorative art', async () => {
    const { container } = render(
      <Tile href="/shows/1" title="Night Shift" art="https://example.com/art.jpg" />,
    )
    const link = screen.getByRole('link', { name: 'Night Shift' })
    expect(link).toHaveAttribute('href', '/shows/1')
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
    expect(container.querySelector('.nr-tile__fallback')).toBeNull()
    await expectNoA11yViolations(container)
  })
})
