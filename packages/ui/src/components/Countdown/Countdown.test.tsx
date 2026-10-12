import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { Countdown } from './Countdown'

describe('Countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts down with an accessible label and completes once', () => {
    const onComplete = vi.fn()
    render(<Countdown seconds={3} onComplete={onComplete} />)
    const timer = screen.getByRole('timer')
    expect(timer).toHaveAccessibleName('Next episode in 3 seconds')
    act(() => vi.advanceTimersByTime(2100))
    expect(timer).toHaveAccessibleName('Next episode in 1 second')
    act(() => vi.advanceTimersByTime(1500))
    expect(timer).toHaveAccessibleName('Next episode in 0 seconds')
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('does not advance while paused', () => {
    const onComplete = vi.fn()
    render(<Countdown seconds={2} paused onComplete={onComplete} />)
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByRole('timer')).toHaveAccessibleName('Next episode in 2 seconds')
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('has no axe violations', async () => {
    vi.useRealTimers()
    const { container } = render(<Countdown seconds={10} />)
    await expectNoA11yViolations(container)
  })
})
