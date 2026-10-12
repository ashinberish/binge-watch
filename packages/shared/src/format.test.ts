import { describe, expect, it } from 'vitest'
import { episodeLabel, formatDuration, initials, progressRatio, timeLeft } from './format'

describe('episodeLabel', () => {
  it('uses a spaced middle dot', () => {
    expect(episodeLabel(2, 5)).toBe('S2 · E5')
  })
  it('floors and clamps bad input', () => {
    expect(episodeLabel(1.7, -3)).toBe('S1 · E0')
    expect(episodeLabel(Number.NaN, 4)).toBe('S0 · E4')
  })
})

describe('timeLeft', () => {
  it('rounds remaining minutes up', () => {
    expect(timeLeft(30 * 60, 48 * 60)).toBe('18 min left')
    expect(timeLeft(30 * 60 + 10, 48 * 60)).toBe('18 min left')
  })
  it('switches to hours for long remainders', () => {
    expect(timeLeft(0, 72 * 60)).toBe('1 h 12 min left')
  })
  it('reports finished when nothing remains', () => {
    expect(timeLeft(50 * 60, 48 * 60)).toBe('Finished')
  })
})

describe('formatDuration', () => {
  it('formats minutes', () => {
    expect(formatDuration(48 * 60)).toBe('48 min')
  })
  it('formats hours and minutes', () => {
    expect(formatDuration(72 * 60)).toBe('1 h 12 min')
    expect(formatDuration(120 * 60)).toBe('2 h')
  })
  it('never shows 0 min for short non-zero runtimes', () => {
    expect(formatDuration(20)).toBe('1 min')
    expect(formatDuration(0)).toBe('0 min')
  })
})

describe('progressRatio', () => {
  it('returns a clamped fraction', () => {
    expect(progressRatio(30, 60)).toBe(0.5)
    expect(progressRatio(90, 60)).toBe(1)
    expect(progressRatio(-5, 60)).toBe(0)
  })
  it('returns 0 for unknown durations', () => {
    expect(progressRatio(10, 0)).toBe(0)
    expect(progressRatio(10, Number.NaN)).toBe(0)
  })
})

describe('initials', () => {
  it('takes first and last initials', () => {
    expect(initials('Ana Maria Lopez')).toBe('AL')
    expect(initials('  kai ')).toBe('K')
    expect(initials('')).toBe('')
  })
})
