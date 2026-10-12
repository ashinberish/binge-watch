import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', false, null, { b: true, c: false }, ['d'])).toBe('a b d')
  })
})
