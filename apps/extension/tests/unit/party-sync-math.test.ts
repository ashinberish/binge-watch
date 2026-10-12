import { describe, expect, it } from 'vitest'

import { createClockEstimator } from '../../src/party/clock'
import { correctDrift, expectedPosition } from '../../src/party/position'
import { playbackState as state } from './fixtures'

describe('expectedPosition', () => {
  it('advances a playing state by the time since it was set, times the rate', () => {
    expect(expectedPosition(state(), 1_010)).toBe(110)
    expect(expectedPosition(state({ rate: 1.5 }), 1_010)).toBe(115)
    expect(expectedPosition(state({ rate: 0.5 }), 1_004)).toBe(102)
  })

  it('holds a paused state where it is', () => {
    expect(expectedPosition(state({ paused: true }), 1_500)).toBe(100)
  })

  it('never runs backwards when the clock estimate is slightly behind', () => {
    expect(expectedPosition(state(), 999.5)).toBe(100)
  })
})

describe('correctDrift', () => {
  it('seeks when more than a second apart, playing or paused', () => {
    expect(correctDrift(50, 52.5, true, 1)).toEqual({ kind: 'seek', to: 52.5 })
    expect(correctDrift(54, 52.5, true, 1)).toEqual({ kind: 'seek', to: 52.5 })
    expect(correctDrift(50, 52.5, false, 1)).toEqual({ kind: 'seek', to: 52.5 })
  })

  it('nudges the speed for small gaps while playing: faster when behind, slower when ahead', () => {
    const behind = correctDrift(50, 50.6, true, 1)
    expect(behind.kind).toBe('nudge')
    expect(behind.kind === 'nudge' && behind.rate).toBeCloseTo(1.05)
    const ahead = correctDrift(50.6, 50, true, 2)
    expect(ahead.kind === 'nudge' && ahead.rate).toBeCloseTo(1.9)
  })

  it('leaves small gaps alone while paused, and tiny gaps always', () => {
    expect(correctDrift(50, 50.6, false, 1)).toEqual({ kind: 'none' })
    expect(correctDrift(50, 50.2, true, 1)).toEqual({ kind: 'none' })
    expect(correctDrift(50, 51, true, 1).kind).toBe('nudge') // exactly 1.0 s is still soft
  })

  it('never seeks before the start', () => {
    expect(correctDrift(5, -3, true, 1)).toEqual({ kind: 'seek', to: 0 })
  })
})

describe('clock estimator', () => {
  it('reports zero offset until the first sample', () => {
    const clock = createClockEstimator()
    expect(clock.ready()).toBe(false)
    expect(clock.offsetMs()).toBe(0)
    expect(clock.serverNow(5_000)).toBe(5)
  })

  it('uses the midpoint of the round trip for the first sample', () => {
    const clock = createClockEstimator()
    // Sent at 1000, back at 1100: the server read 3.05 s at local 1050 → +2000 ms.
    clock.sample(1_000, 1_100, 3.05)
    expect(clock.ready()).toBe(true)
    expect(clock.offsetMs()).toBe(2_000)
    expect(clock.serverNow(10_000)).toBe(12)
  })

  it('smooths later samples instead of jumping', () => {
    const clock = createClockEstimator({ alpha: 0.25 })
    clock.sample(0, 100, 2.05) // +2000
    clock.sample(10_000, 10_100, 12.45) // +2400 measured
    expect(clock.offsetMs()).toBe(2_100)
  })

  it('skips a slow round trip, but accepts a run of them', () => {
    const clock = createClockEstimator({ alpha: 1, maxSkipped: 2 })
    clock.sample(0, 100, 2.05) // +2000, best rtt 100
    clock.sample(1_000, 2_000, 4.5) // rtt 1000: outlier, +3000 ignored
    expect(clock.offsetMs()).toBe(2_000)
    clock.sample(3_000, 4_000, 6.5) // second outlier
    expect(clock.offsetMs()).toBe(2_000)
    clock.sample(5_000, 6_000, 8.5) // third in a row: the network really is slower
    expect(clock.offsetMs()).toBe(3_000)
  })

  it('ignores impossible samples', () => {
    const clock = createClockEstimator()
    clock.sample(1_000, 900, 5)
    clock.sample(1_000, 1_100, Number.NaN)
    expect(clock.ready()).toBe(false)
  })
})
