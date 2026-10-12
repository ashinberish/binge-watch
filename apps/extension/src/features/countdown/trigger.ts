/** Whether the next-episode card should be up right now. */
export function shouldShowCountdown(
  remainingSeconds: number,
  countdownSeconds: number,
  hasNext: boolean,
  isAd: boolean,
): boolean {
  if (!hasNext || isAd) return false
  if (!Number.isFinite(remainingSeconds) || remainingSeconds < 0) return false
  return remainingSeconds <= countdownSeconds
}

export type CountdownPhase = 'idle' | 'showing' | 'dismissed'

export interface CountdownState {
  /** Which episode this state is about; a new episode starts over. */
  episodeKey: string | null
  phase: CountdownPhase
  /** Ring length in seconds, fixed when the card appears. */
  seconds: number
}

export interface PlayerTick {
  episodeKey: string | null
  remainingSeconds: number
  ended: boolean
  countdownSeconds: number
  hasNext: boolean
  isAd: boolean
}

export const initialCountdown: CountdownState = { episodeKey: null, phase: 'idle', seconds: 0 }

/**
 * One step of the overlay state machine, run on every player tick:
 * idle → showing when the end is near (or the video ended), showing → idle when the
 * viewer seeks back or an ad starts, and dismissed sticks until the episode changes.
 */
export function nextCountdown(prev: CountdownState, tick: PlayerTick): CountdownState {
  const state =
    prev.episodeKey === tick.episodeKey
      ? prev
      : { ...initialCountdown, episodeKey: tick.episodeKey }
  if (state.phase === 'dismissed' || tick.episodeKey === null) return state
  const remaining = tick.ended ? 0 : tick.remainingSeconds
  const show = shouldShowCountdown(remaining, tick.countdownSeconds, tick.hasNext, tick.isAd)
  if (state.phase === 'idle' && show) {
    const seconds = tick.ended
      ? tick.countdownSeconds
      : Math.min(tick.countdownSeconds, Math.max(1, Math.ceil(remaining)))
    return { ...state, phase: 'showing', seconds }
  }
  if (state.phase === 'showing' && !show) return { ...state, phase: 'idle', seconds: 0 }
  return state
}

export function dismissCountdown(state: CountdownState): CountdownState {
  return { ...state, phase: 'dismissed' }
}
