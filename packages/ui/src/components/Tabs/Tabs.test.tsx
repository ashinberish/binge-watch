import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs'

describe('Tabs', () => {
  it('switches panels with the keyboard', async () => {
    const { container } = render(
      <Tabs defaultValue="watching">
        <TabsList aria-label="Library">
          <TabsTrigger value="watching">Watching</TabsTrigger>
          <TabsTrigger value="finished">Finished</TabsTrigger>
        </TabsList>
        <TabsContent value="watching">Continue watching</TabsContent>
        <TabsContent value="finished">Finished shows</TabsContent>
      </Tabs>,
    )
    expect(screen.getByRole('tab', { name: 'Watching' })).toHaveAttribute('aria-selected', 'true')
    await expectNoA11yViolations(container)
    screen.getByRole('tab', { name: 'Watching' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Finished' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Finished shows')
  })
})
