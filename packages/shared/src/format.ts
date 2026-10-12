const MIDDLE_DOT = '·'

const toWholeNonNegative = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0

/** "S2 · E5" — season and episode numbers separated by a spaced middle dot. */
export function episodeLabel(season: number, episode: number): string {
  return `S${toWholeNonNegative(season)} ${MIDDLE_DOT} E${toWholeNonNegative(episode)}`
}

/** Fraction watched, clamped to 0–1. Returns 0 when the duration is unknown. */
export function progressRatio(positionSec: number, durationSec: number): number {
  if (!Number.isFinite(positionSec) || !Number.isFinite(durationSec) || durationSec <= 0) return 0
  return Math.min(1, Math.max(0, positionSec / durationSec))
}

/**
 * Human duration: "48 min", "1 h 12 min", "2 h". Anything under a minute but above
 * zero rounds up to "1 min" so the copy never reads "0 min" for a non-empty runtime.
 */
export function formatDuration(sec: number): string {
  const total = Number.isFinite(sec) ? Math.max(0, sec) : 0
  let minutes = Math.round(total / 60)
  if (minutes === 0 && total > 0) minutes = 1
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${minutes} min`
  if (rest === 0) return `${hours} h`
  return `${hours} h ${rest} min`
}

/** "18 min left" — remaining time of an episode, rounded up to the minute. */
export function timeLeft(positionSec: number, durationSec: number): string {
  const remaining = Math.max(
    0,
    (Number.isFinite(durationSec) ? durationSec : 0) - Math.max(0, positionSec || 0),
  )
  const minutes = Math.ceil(remaining / 60)
  if (minutes <= 0) return 'Finished'
  if (minutes >= 60) return `${formatDuration(minutes * 60)} left`
  return `${minutes} min left`
}

/** Two-letter initials for avatars: "Ana Lopez" → "AL", "kai" → "K". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}
