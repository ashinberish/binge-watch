import { describe, expect, it } from 'vitest'

import { clampCountdown, normalizeSettings } from '../../src/lib/settings'

describe('settings', () => {
  it('defaults the countdown to 10 seconds', () => {
    expect(normalizeSettings({})).toEqual({ countdownSeconds: 10 })
  })

  it('keeps the countdown between 5 and 30 seconds', () => {
    expect(clampCountdown(2)).toBe(5)
    expect(clampCountdown(45)).toBe(30)
    expect(clampCountdown('15')).toBe(15)
    expect(clampCountdown('nope')).toBe(10)
  })
})
