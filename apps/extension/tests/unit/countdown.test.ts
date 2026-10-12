import { describe, expect, it } from 'vitest'

import { nextEpisodeLine } from '../../src/features/countdown/NextEpisodeCard'
import {
  dismissCountdown,
  initialCountdown,
  nextCountdown,
  shouldShowCountdown,
  type PlayerTick,
} from '../../src/features/countdown/trigger'

describe('shouldShowCountdown', () => {
  it('shows once the remaining time is within the countdown', () => {
    expect(shouldShowCountdown(10, 10, true, false)).toBe(true)
    expect(shouldShowCountdown(3.5, 10, true, false)).toBe(true)
    expect(shouldShowCountdown(0, 10, true, false)).toBe(true)
    expect(shouldShowCountdown(10.5, 10, true, false)).toBe(false)
  })

  it('never shows without a next episode or over an ad', () => {
    expect(shouldShowCountdown(5, 10, false, false)).toBe(false)
    expect(shouldShowCountdown(5, 10, true, true)).toBe(false)
  })

  it('ignores unknown durations', () => {
    expect(shouldShowCountdown(Number.NaN, 10, true, false)).toBe(false)
    expect(shouldShowCountdown(-1, 10, true, false)).toBe(false)
  })
})

const tick = (overrides: Partial<PlayerTick> = {}): PlayerTick => ({
  episodeKey: 'ep1',
  remainingSeconds: 600,
  ended: false,
  countdownSeconds: 10,
  hasNext: true,
  isAd: false,
  ...overrides,
})

describe('nextCountdown', () => {
  it('appears near the end with a ring as long as the time left', () => {
    let state = nextCountdown(initialCountdown, tick())
    expect(state.phase).toBe('idle')
    state = nextCountdown(state, tick({ remainingSeconds: 7.2 }))
    expect(state).toMatchObject({ phase: 'showing', seconds: 8 })
  })

  it('appears for the full countdown when the video ended', () => {
    const state = nextCountdown(initialCountdown, tick({ remainingSeconds: 600, ended: true }))
    expect(state).toMatchObject({ phase: 'showing', seconds: 10 })
  })

  it('hides when the viewer seeks back or an ad starts', () => {
    const showing = nextCountdown(initialCountdown, tick({ remainingSeconds: 5 }))
    expect(nextCountdown(showing, tick({ remainingSeconds: 300 })).phase).toBe('idle')
    expect(nextCountdown(showing, tick({ remainingSeconds: 5, isAd: true })).phase).toBe('idle')
  })

  it('stays dismissed for the episode, and resets for the next one', () => {
    const dismissed = dismissCountdown(
      nextCountdown(initialCountdown, tick({ remainingSeconds: 5 })),
    )
    expect(nextCountdown(dismissed, tick({ remainingSeconds: 2 })).phase).toBe('dismissed')
    expect(nextCountdown(dismissed, tick({ ended: true })).phase).toBe('dismissed')
    const next = nextCountdown(dismissed, tick({ episodeKey: 'ep2', remainingSeconds: 2 }))
    expect(next).toMatchObject({ episodeKey: 'ep2', phase: 'showing' })
  })

  it('stays idle without a next episode', () => {
    expect(
      nextCountdown(initialCountdown, tick({ remainingSeconds: 2, hasNext: false })).phase,
    ).toBe('idle')
  })
})

describe('nextEpisodeLine', () => {
  it('uses the shared episode label', () => {
    expect(
      nextEpisodeLine({
        episode_id: 'e',
        season_number: 1,
        episode_number: 3,
        title: 'High tide',
        duration_seconds: 1,
      }),
    ).toBe('Up next · S1 · E3 — High tide')
  })
})
