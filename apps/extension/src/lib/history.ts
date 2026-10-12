import { episodeLabel } from '@nightreel/shared'

import type { HistoryItem } from './types'

/** Rows per page of watch history (the API's `limit`). A full page means there may be more. */
export const HISTORY_PAGE_SIZE = 30

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/** Local calendar day as a sortable key, e.g. "2026-10-12". */
function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** "Today", "Yesterday", else "Mon 12 Oct" (local time; the year only when it differs). */
export function dayLabel(date: Date, now: Date): string {
  const key = dayKey(date)
  if (key === dayKey(now)) return 'Today'
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (key === dayKey(yesterday)) return 'Yesterday'
  const label = `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`
  return date.getFullYear() === now.getFullYear() ? label : `${label} ${date.getFullYear()}`
}

export interface HistoryDay {
  key: string
  label: string
  items: HistoryItem[]
}

/** Rows (newest first) grouped by the local day they were last watched, in order. */
export function groupByDay(items: HistoryItem[], now: Date): HistoryDay[] {
  const days: HistoryDay[] = []
  for (const item of items) {
    const date = new Date(item.updated_at)
    if (Number.isNaN(date.getTime())) continue
    const key = dayKey(date)
    const last = days.at(-1)
    if (last?.key === key) last.items.push(item)
    else days.push({ key, label: dayLabel(date, now), items: [item] })
  }
  return days
}

/** "S2 · E5 · Episode title", or "S2 · E5" without a title. */
export function historyMeta(item: HistoryItem): string {
  const label = episodeLabel(item.season_number, item.episode_number)
  const title = item.episode_title?.trim()
  return title ? `${label} · ${title}` : label
}

/** The cursor for the next page, or null when this page was the last. */
export function nextCursor(page: HistoryItem[]): string | null {
  return page.length >= HISTORY_PAGE_SIZE ? (page.at(-1)?.updated_at ?? null) : null
}

/** Appends a page, skipping rows already shown (a row can move while paging). */
export function appendPage(items: HistoryItem[], page: HistoryItem[]): HistoryItem[] {
  const seen = new Set(items.map((item) => `${item.episode_id}@${item.updated_at}`))
  return [...items, ...page.filter((item) => !seen.has(`${item.episode_id}@${item.updated_at}`))]
}
