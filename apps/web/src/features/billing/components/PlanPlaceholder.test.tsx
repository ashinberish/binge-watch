import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '@/test/render'
import { PlanPlaceholder } from './PlanPlaceholder'

describe('PlanPlaceholder', () => {
  it('announces plans are coming soon', async () => {
    const { container } = render(<PlanPlaceholder />)
    expect(screen.getByRole('heading', { name: 'Plans are coming soon' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manage plan' })).toBeDisabled()
    await expectNoA11yViolations(container)
  })
})
