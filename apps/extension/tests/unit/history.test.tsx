// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HistoryList, type LoadHistory } from '../../src/features/history/HistoryList'
import {
  appendPage,
  dayLabel,
  groupByDay,
  HISTORY_PAGE_SIZE,
  historyMeta,
  nextCursor,
} from '../../src/lib/history'
import { fail, ok } from '../../src/lib/result'
import type { HistoryItem } from '../../src/lib/types'
import { expectNoA11yViolations } from './a11y'

afterEach(() => cleanup())

// Mon 12 Oct 2026, 21:30 local time.
const NOW = new Date(2026, 9, 12, 21, 30)

const row = (overrides: Partial<HistoryItem> = {}): HistoryItem => ({
  episode_id: 'e1',
  show_id: 's1',
  show_title: 'Harbor Lights',
  poster_url: null,
  season_number: 2,
  episode_number: 5,
  episode_title: 'Low tide',
  position_seconds: 1_920,
  duration_seconds: 3_000,
  updated_at: new Date(2026, 9, 12, 20, 0).toISOString(),
  completed: false,
  ...overrides,
})

describe('history helpers', () => {
  it('labels days as Today, Yesterday, then weekday, day and month', () => {
    expect(dayLabel(new Date(2026, 9, 12, 0, 5), NOW)).toBe('Today')
    expect(dayLabel(new Date(2026, 9, 11, 23, 59), NOW)).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 9, 5, 12), NOW)).toBe('Mon 5 Oct')
    expect(dayLabel(new Date(2025, 11, 31, 12), NOW)).toBe('Wed 31 Dec 2025')
    // Across a month boundary.
    expect(dayLabel(new Date(2026, 8, 30), new Date(2026, 9, 1, 9))).toBe('Yesterday')
  })

  it('groups newest-first rows by day', () => {
    const days = groupByDay(
      [
        row({ episode_id: 'a', updated_at: new Date(2026, 9, 12, 20).toISOString() }),
        row({ episode_id: 'b', updated_at: new Date(2026, 9, 12, 1).toISOString() }),
        row({ episode_id: 'c', updated_at: new Date(2026, 9, 11, 22).toISOString() }),
        row({ episode_id: 'd', updated_at: 'not a date' }),
      ],
      NOW,
    )
    expect(days.map((d) => [d.label, d.items.map((i) => i.episode_id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
    ])
  })

  it('formats the meta line and pages', () => {
    expect(historyMeta(row())).toBe('S2 · E5 · Low tide')
    expect(historyMeta(row({ episode_title: null }))).toBe('S2 · E5')
    expect(nextCursor([row()])).toBeNull()
    const full = Array.from({ length: HISTORY_PAGE_SIZE }, (_, i) =>
      row({ episode_id: `e${i}`, updated_at: `2026-10-${String(30 - i).padStart(2, '0')}` }),
    )
    expect(nextCursor(full)).toBe(full.at(-1)?.updated_at)
    expect(
      appendPage([row()], [row(), row({ episode_id: 'e2' })]).map((r) => r.episode_id),
    ).toEqual(['e1', 'e2'])
  })
})

describe('history list', () => {
  const now = () => NOW

  it('shows rows by day, with progress or Watched', async () => {
    const load: LoadHistory = vi.fn(async () =>
      ok([
        row(),
        row({
          episode_id: 'e2',
          show_title: 'Night Shift',
          completed: true,
          position_seconds: 3_000,
          updated_at: new Date(2026, 9, 11, 22).toISOString(),
        }),
      ]),
    )
    const { container } = render(<HistoryList profileId="p1" load={load} now={now} />)
    const today = await screen.findByRole('region', { name: 'Today' })
    expect(within(today).getByText('Harbor Lights')).toBeTruthy()
    expect(within(today).getByText('S2 · E5 · Low tide')).toBeTruthy()
    expect(within(today).getByText('18 min left')).toBeTruthy()
    expect(within(today).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('64')
    const yesterday = screen.getByRole('region', { name: 'Yesterday' })
    expect(within(yesterday).getByText('Watched')).toBeTruthy()
    expect(within(yesterday).queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    expect(load).toHaveBeenCalledWith(null)
    await expectNoA11yViolations(container)
  })

  it('loads more after a full page', async () => {
    const first = Array.from({ length: HISTORY_PAGE_SIZE }, (_, i) =>
      row({ episode_id: `e${i}`, updated_at: new Date(2026, 9, 12, 20, 59 - i).toISOString() }),
    )
    const load = vi.fn<LoadHistory>(async (cursor) =>
      cursor === null
        ? ok(first)
        : ok([row({ episode_id: 'old', updated_at: new Date(2026, 9, 1).toISOString() })]),
    )
    render(<HistoryList profileId="p1" load={load} now={now} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Load more' }))
    expect(load).toHaveBeenLastCalledWith(first.at(-1)?.updated_at)
    expect(await screen.findByRole('region', { name: 'Thu 1 Oct' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('has an empty state and a short error', async () => {
    const { unmount } = render(<HistoryList profileId="p1" load={async () => ok([])} now={now} />)
    expect(await screen.findByText('Episodes you watch show up here.')).toBeTruthy()
    unmount()
    render(<HistoryList profileId="p1" load={async () => fail('network')} now={now} />)
    expect(await screen.findByText('Cannot reach Nightreel. Check your connection.')).toBeTruthy()
  })

  it('shows skeletons while loading', () => {
    render(<HistoryList profileId="p1" load={() => new Promise(() => undefined)} now={now} />)
    expect(screen.getByLabelText('Loading watch history').getAttribute('aria-busy')).toBe('true')
  })
})
