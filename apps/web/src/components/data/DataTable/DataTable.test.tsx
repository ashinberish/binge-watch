import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '@/test/render'
import { DataTable } from './DataTable'

const rows = [
  { id: 1, title: 'Night Shift', episodes: 12 },
  { id: 2, title: 'Harbour Lights', episodes: 8 },
]

describe('DataTable', () => {
  it('renders a captioned table', async () => {
    const { container } = render(
      <DataTable
        caption="Recently watched"
        rows={rows}
        getRowKey={(r) => r.id}
        columns={[
          { key: 'title', header: 'Show', cell: (r) => r.title },
          { key: 'episodes', header: 'Episodes', cell: (r) => r.episodes, align: 'end' },
        ]}
      />,
    )
    const table = screen.getByRole('table', { name: 'Recently watched' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(screen.getByRole('columnheader', { name: 'Episodes' })).toBeInTheDocument()
    await expectNoA11yViolations(container)
  })

  it('shows the empty message', () => {
    render(
      <DataTable
        caption="History"
        rows={[]}
        getRowKey={() => 0}
        columns={[{ key: 'a', header: 'A', cell: () => null }]}
      />,
    )
    expect(screen.getByText('Nothing to show yet.')).toBeInTheDocument()
  })
})
