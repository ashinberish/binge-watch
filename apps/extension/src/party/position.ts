import type { PlaybackState } from './protocol'

/** Beyond this many seconds apart, jump straight to the room's position. */
export const HARD_DRIFT_SECONDS = 1.0
/** Between this and the hard limit, while playing, catch up by changing speed. */
export const SOFT_DRIFT_SECONDS = 0.3
/** How much faster or slower a soft correction plays. */
export const NUDGE_FACTOR = 0.05
/** How long a soft correction lasts before the speed goes back to normal. */
export const NUDGE_MS = 3_000

/**
 * Where the room's video should be at `serverNow` (server epoch seconds):
 * position + (paused ? 0 : (serverNow − updated_at) × rate).
 */
export function expectedPosition(state: PlaybackState, serverNow: number): number {
  if (state.paused) return state.position
  const elapsed = Math.max(0, serverNow - state.updated_at)
  return state.position + elapsed * state.rate
}

export type DriftCorrection =
  | { kind: 'none' }
  | { kind: 'seek'; to: number }
  /** Play at `rate` for a few seconds, then go back to the room's rate. */
  | { kind: 'nudge'; rate: number }

/**
 * What to do about the gap between the local video and the room: a hard seek when
 * more than a second apart, a ±5% speed nudge for small gaps while playing, else nothing.
 */
export function correctDrift(
  local: number,
  expected: number,
  playing: boolean,
  rate: number,
): DriftCorrection {
  const drift = local - expected
  const gap = Math.abs(drift)
  if (gap > HARD_DRIFT_SECONDS) return { kind: 'seek', to: Math.max(0, expected) }
  if (playing && gap > SOFT_DRIFT_SECONDS) {
    // Behind the room: speed up. Ahead: slow down.
    return { kind: 'nudge', rate: rate * (drift < 0 ? 1 + NUDGE_FACTOR : 1 - NUDGE_FACTOR) }
  }
  return { kind: 'none' }
}
