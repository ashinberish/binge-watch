import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Badge } from './Badge'

describe('Badge', () => {
  it('renders variants', async () => {
    const { container } = render(
      <p>
        <Badge>Kids</Badge> <Badge variant="new">New episode</Badge>
      </p>,
    )
    expect(screen.getByText('New episode')).toHaveClass('nr-badge--new')
    expect(screen.getByText('Kids')).toHaveClass('nr-badge--neutral')
    await expectNoA11yViolations(container)
  })
})
