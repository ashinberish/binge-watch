import { Tile } from '@nightreel/ui'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '@/test/render'
import { TileRow } from './TileRow'

describe('TileRow', () => {
  it('renders tiles in a labelled list', async () => {
    const { container } = render(
      <TileRow title="Continue watching">
        <Tile title="Night Shift" meta="S2 · E5" />
        <Tile title="Harbour Lights" meta="S1 · E2" />
      </TileRow>,
    )
    expect(screen.getByRole('region', { name: 'Continue watching' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(
      screen.getByRole('button', { name: 'Scroll continue watching right' }),
    ).toBeInTheDocument()
    await expectNoA11yViolations(container)
  })

  it('shows skeletons while loading and the empty slot otherwise', () => {
    const { rerender } = render(<TileRow title="Continue watching" loading />)
    expect(screen.getByRole('status', { name: 'Loading continue watching' })).toBeInTheDocument()
    rerender(<TileRow title="Continue watching" empty={<p>Nothing here yet.</p>} />)
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument()
  })
})
