import { NEXT_EPISODE_COUNTDOWN_SECONDS } from '@nightreel/shared'

import type { Settings } from '../messaging/protocol'

export const COUNTDOWN_MIN = 5
export const COUNTDOWN_MAX = 30
export const COUNTDOWN_CHOICES = [5, 10, 15, 20, 30] as const

export function clampCountdown(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return NEXT_EPISODE_COUNTDOWN_SECONDS
  return Math.min(COUNTDOWN_MAX, Math.max(COUNTDOWN_MIN, Math.round(n)))
}

export function normalizeSettings(stored: { countdownSeconds?: unknown }): Settings {
  return {
    countdownSeconds:
      stored.countdownSeconds === undefined
        ? NEXT_EPISODE_COUNTDOWN_SECONDS
        : clampCountdown(stored.countdownSeconds),
  }
}
