import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Card, CardBody, CardFooter, CardHeader } from './Card'

describe('Card', () => {
  it('composes header, body and footer', async () => {
    const { container } = render(
      <Card aria-labelledby="plan-title" elevation="raised">
        <CardHeader
          id="plan-title"
          title="Plans are coming soon"
          description="You are on the free plan."
        />
        <CardBody>Everything is included while we are in beta.</CardBody>
        <CardFooter>
          <button type="button">Manage plan</button>
        </CardFooter>
      </Card>,
    )
    expect(
      screen.getByRole('heading', { level: 2, name: 'Plans are coming soon' }),
    ).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('nr-card', 'nr-card--raised', 'nr-card--pad-md')
    await expectNoA11yViolations(container)
  })

  it('supports other heading levels', () => {
    render(<CardHeader title="Streak" headingLevel={3} />)
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Streak')
  })
})
