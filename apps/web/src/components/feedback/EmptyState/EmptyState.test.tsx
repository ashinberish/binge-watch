import { Button } from '@nightreel/ui'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '@/test/render'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders title, description and action', async () => {
    const { container } = render(
      <EmptyState
        icon="tv"
        title="Nothing in progress"
        description="Start a show and it will appear here."
        action={<Button>Add to list</Button>}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Nothing in progress' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to list' })).toBeInTheDocument()
    await expectNoA11yViolations(container)
  })
})
