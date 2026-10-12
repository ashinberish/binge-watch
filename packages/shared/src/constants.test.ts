import { describe, expect, it } from 'vitest'
import { AVATAR_COLORS, MAX_PROFILES } from './constants'

describe('constants', () => {
  it('caps profiles at five', () => {
    expect(MAX_PROFILES).toBe(5)
  })
  it('offers at least as many avatar colours as profiles', () => {
    expect(AVATAR_COLORS.length).toBeGreaterThanOrEqual(MAX_PROFILES)
    for (const c of AVATAR_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })
})
