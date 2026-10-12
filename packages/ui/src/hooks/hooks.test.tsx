import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDisclosure } from './useDisclosure'
import { useMediaQuery } from './useMediaQuery'

describe('useDisclosure', () => {
  it('opens, closes and toggles', () => {
    const { result } = renderHook(() => useDisclosure())
    expect(result.current.open).toBe(false)
    act(() => result.current.onOpen())
    expect(result.current.open).toBe(true)
    act(() => result.current.onToggle())
    expect(result.current.open).toBe(false)
  })
})

describe('useMediaQuery', () => {
  const original = window.matchMedia
  afterEach(() => {
    window.matchMedia = original
  })

  it('reflects matchMedia', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    const { result } = renderHook(() => useMediaQuery('(min-width: 600px)'))
    expect(result.current).toBe(true)
  })
})
