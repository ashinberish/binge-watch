import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EpisodeMeta } from './EpisodeMeta'

describe('EpisodeMeta', () => {
  it('shows label, title and time left', () => {
    const { container } = render(
      <EpisodeMeta
        season={2}
        episode={5}
        episodeTitle="Lights out"
        positionSeconds={1800}
        durationSeconds={2880}
      />,
    )
    expect(container).toHaveTextContent('S2 · E5 · Lights out · 18 min left')
  })

  it('shows the runtime when not started', () => {
    const { container } = render(<EpisodeMeta season={1} episode={1} durationSeconds={4320} />)
    expect(container).toHaveTextContent('S1 · E1 · 1 h 12 min')
  })
})
