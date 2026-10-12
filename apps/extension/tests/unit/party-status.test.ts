import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AWAY_AFTER_MS,
  createStatusReporter,
  deriveStatus,
  STATUS_DEBOUNCE_MS,
} from '../../src/party/status'

const base = { isAd: false, buffering: false, hiddenSince: null, now: 100_000 }

describe('deriveStatus', () => {
  it('is watching by default', () => {
    expect(deriveStatus(base)).toBe('watching')
  })

  it('puts ads first, then buffering', () => {
    expect(deriveStatus({ ...base, isAd: true, buffering: true, hiddenSince: 0 })).toBe('ad')
    expect(deriveStatus({ ...base, buffering: true, hiddenSince: 0 })).toBe('buffering')
  })

  it('counts as away only after the tab is hidden for more than 5 s', () => {
    expect(deriveStatus({ ...base, hiddenSince: base.now - AWAY_AFTER_MS })).toBe('watching')
    expect(deriveStatus({ ...base, hiddenSince: base.now - AWAY_AFTER_MS - 1 })).toBe('away')
  })
})

describe('status reporter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends a change once it has held for the debounce time', () => {
    const send = vi.fn()
    const reporter = createStatusReporter({ send })
    reporter.update('buffering')
    vi.advanceTimersByTime(STATUS_DEBOUNCE_MS - 1)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(send).toHaveBeenCalledWith('buffering')
    expect(reporter.sent).toBe('buffering')
  })

  it('does not send flickers or repeats', () => {
    const send = vi.fn()
    const reporter = createStatusReporter({ send })
    reporter.update('watching') // the room already assumes this
    reporter.update('buffering')
    vi.advanceTimersByTime(200)
    reporter.update('watching') // back before the debounce ran out
    vi.advanceTimersByTime(1_000)
    expect(send).not.toHaveBeenCalled()

    reporter.update('ad')
    vi.advanceTimersByTime(200)
    reporter.update('ad') // same pending status does not restart the wait
    vi.advanceTimersByTime(300)
    expect(send).toHaveBeenCalledTimes(1)
    reporter.update('ad')
    vi.advanceTimersByTime(1_000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('starts from watching again after a reset', () => {
    const send = vi.fn()
    const reporter = createStatusReporter({ send })
    reporter.update('away')
    vi.advanceTimersByTime(STATUS_DEBOUNCE_MS)
    reporter.reset()
    reporter.update('away')
    vi.advanceTimersByTime(STATUS_DEBOUNCE_MS)
    expect(send.mock.calls).toEqual([['away'], ['away']])
  })
})
