import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations, renderWithProviders } from '@/test/render'
import { StreakBanner } from './components/StreakBanner'
import { streakCopy } from './copy'

describe('streakCopy', () => {
  it('celebrates a big night', () => {
    expect(streakCopy({ current_days: 4, longest_days: 9, episodes_today: 5 })).toEqual({
      headline: '5 episodes tonight. Nice run.',
      detail: '4 nights in a row. Your best is 9.',
    })
  })

  it('handles singulars and personal bests', () => {
    expect(streakCopy({ current_days: 1, longest_days: 1, episodes_today: 1 })).toEqual({
      headline: '1 episode tonight.',
      detail: '1 night in a row, your best yet.',
    })
  })

  it('nudges without guilt', () => {
    expect(streakCopy({ current_days: 3, longest_days: 5, episodes_today: 0 }).headline).toBe(
      'Watch an episode tonight to keep your streak going.',
    )
    expect(streakCopy({ current_days: 0, longest_days: 0, episodes_today: 0 })).toEqual({
      headline: 'Start a streak tonight.',
      detail: 'Watch on consecutive nights to build one.',
    })
  })
})

describe('StreakBanner', () => {
  it('shows the streak from the API', async () => {
    const { container } = renderWithProviders(<StreakBanner profileId="p_1" />)
    expect(await screen.findByText('5 episodes tonight. Nice run.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Your streak' })).toBeInTheDocument()
    await expectNoA11yViolations(container)
  })
})
