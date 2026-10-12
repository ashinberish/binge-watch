import type { MemberStatus } from './protocol'

/** The tab has to stay hidden this long before the viewer counts as away. */
export const AWAY_AFTER_MS = 5_000
/** A status has to hold this long before it is sent, so flickers are not. */
export const STATUS_DEBOUNCE_MS = 500

export interface StatusInputs {
  /** The player is showing an ad. */
  isAd: boolean
  /** A waiting/stalled event has not been followed by playing yet. */
  buffering: boolean
  /** Local epoch ms when the page became hidden, or null while it is visible. */
  hiddenSince: number | null
  now: number
}

/**
 * What this viewer is doing, for the member list. An ad wins over everything (the
 * viewer is stuck either way), then buffering, then a tab hidden for more than 5 s.
 */
export function deriveStatus({ isAd, buffering, hiddenSince, now }: StatusInputs): MemberStatus {
  if (isAd) return 'ad'
  if (buffering) return 'buffering'
  if (hiddenSince !== null && now - hiddenSince > AWAY_AFTER_MS) return 'away'
  return 'watching'
}

export interface StatusReporterDeps {
  send: (status: MemberStatus) => void
  debounceMs?: number
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/**
 * Sends the local status only when it changes and has held for ~500 ms. The room
 * assumes "watching" for a new member, so that is what counts as already sent.
 */
export function createStatusReporter(deps: StatusReporterDeps) {
  const debounceMs = deps.debounceMs ?? STATUS_DEBOUNCE_MS
  const setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms))
  const clearTimer =
    deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  let sent: MemberStatus = 'watching'
  let pending: { status: MemberStatus; timer: unknown } | null = null

  function cancel() {
    if (pending) clearTimer(pending.timer)
    pending = null
  }

  return {
    update(status: MemberStatus) {
      if (pending?.status === status) return
      cancel()
      if (status === sent) return
      const timer = setTimer(() => {
        pending = null
        sent = status
        deps.send(status)
      }, debounceMs)
      pending = { status, timer }
    },

    /** A new party (or a reconnect): the room starts from "watching" again. */
    reset() {
      cancel()
      sent = 'watching'
    },

    dispose() {
      cancel()
    },

    get sent() {
      return sent
    },
  }
}
