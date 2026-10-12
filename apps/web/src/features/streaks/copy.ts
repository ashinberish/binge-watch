export interface StreakCopy {
  headline: string
  detail: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Viewer-facing streak copy. Warm, short, sentence case, no emoji. */
export function streakCopy(streak: {
  current_days: number
  longest_days: number
  episodes_today: number
}): StreakCopy {
  const { current_days: current, longest_days: longest, episodes_today: today } = streak
  let headline: string
  if (today >= 3) headline = `${plural(today, 'episode', 'episodes')} tonight. Nice run.`
  else if (today > 0) headline = `${plural(today, 'episode', 'episodes')} tonight.`
  else if (current > 0) headline = 'Watch an episode tonight to keep your streak going.'
  else headline = 'Start a streak tonight.'

  let detail: string
  if (current === 0)
    detail =
      longest > 0
        ? `Your best streak is ${plural(longest, 'night', 'nights')}.`
        : 'Watch on consecutive nights to build one.'
  else if (current >= longest)
    detail = `${plural(current, 'night', 'nights')} in a row, your best yet.`
  else detail = `${plural(current, 'night', 'nights')} in a row. Your best is ${longest}.`

  return { headline, detail }
}
