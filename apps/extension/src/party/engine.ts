import { correctDrift, expectedPosition, NUDGE_MS } from './position'
import type { ControlAction, PlaybackState } from './protocol'

/** The parts of an HTMLVideoElement the engine touches, so tests can pass a fake. */
export interface VideoLike {
  paused: boolean
  currentTime: number
  playbackRate: number
  play(): Promise<void> | void
  pause(): void
}

export interface LocalPlayback {
  paused: boolean
  currentTime: number
  playbackRate: number
}

/** What to do to the local video to match the room. Applied in this order. */
export interface SyncPlan {
  rate: number | null
  pause: boolean
  seekTo: number | null
  /** Temporary speed for a soft correction. */
  nudgeRate: number | null
  play: boolean
}

/**
 * Pure decision: given the room's state and the local video, what should change.
 * `serverNow` is the server's clock in epoch seconds. While buffering, small gaps are
 * left alone (the video is not advancing, so a speed nudge would mean nothing).
 */
export function planSync(
  state: PlaybackState,
  local: LocalPlayback,
  serverNow: number,
  { buffering = false }: { buffering?: boolean } = {},
): SyncPlan {
  const expected = expectedPosition(state, serverNow)
  const correction = correctDrift(local.currentTime, expected, !state.paused, state.rate)
  return {
    rate: local.playbackRate !== state.rate ? state.rate : null,
    pause: state.paused && !local.paused,
    seekTo: correction.kind === 'seek' ? correction.to : null,
    nudgeRate: correction.kind === 'nudge' && !buffering ? correction.rate : null,
    play: !state.paused && local.paused,
  }
}

/** A local action to send to the room. */
export interface LocalAction {
  action: ControlAction
  position: number
  rate: number
}

export interface SyncEngineDeps {
  /** Local epoch ms. */
  now: () => number
  /** True while the player shows an ad: the engine neither applies nor reports anything. */
  isAd: () => boolean
  report: (action: LocalAction) => void
  /** The browser refused play() without a click; the overlay offers "Click to sync". */
  onAutoplayBlocked: (blocked: boolean) => void
}

/** How long an event caused by applying remote state counts as our own echo. */
export const ECHO_WINDOW_MS = 1_000
/** Seeks can take a while to land on a slow connection. */
export const SEEK_ECHO_WINDOW_MS = 2_500
/** A seeked event this close to where we seeked is ours. */
const SEEK_ECHO_TOLERANCE_SECONDS = 0.5
/** After reporting a local action, give the room this long to echo it before correcting drift. */
export const REPORT_GRACE_MS = 2_000

export type MediaEventType = 'play' | 'pause' | 'seeked' | 'waiting' | 'stalled' | 'playing'

export const MEDIA_EVENTS: readonly MediaEventType[] = [
  'play',
  'pause',
  'seeked',
  'waiting',
  'stalled',
  'playing',
]

/** The server's placeholder before anyone has played, paused or seeked. */
export function isFreshRoom(state: PlaybackState): boolean {
  return state.seq <= 0 && state.by === null
}

function isNotAllowed(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error
    ? (error as { name: unknown }).name === 'NotAllowedError'
    : false
}

/**
 * Keeps one <video> in step with the room. Remote states are applied (newest seq only);
 * local play/pause/seek are reported unless they are the echo of something the engine
 * just did. Call `tick()` about once a second for drift checks and to end speed nudges.
 */
export function createSyncEngine(deps: SyncEngineDeps) {
  let video: VideoLike | null = null
  let lastSeq = Number.NEGATIVE_INFINITY
  let state: PlaybackState | null = null
  let clockOffsetMs = 0
  /** A state arrived during an ad or before the video existed. */
  let pending = false
  let buffering = false
  let blocked = false
  let nudgeUntil: number | null = null
  let reportedAt = Number.NEGATIVE_INFINITY
  /** The room has no real state yet; this player's state goes up as soon as it can. */
  let seeding = false

  // Echo suppression: what applying remote state is expected to make the video do.
  let expectPlayUntil = 0
  let expectPauseUntil = 0
  let expectSeek: { to: number; until: number } | null = null

  const serverNow = () => (deps.now() + clockOffsetMs) / 1000

  function setBlocked(next: boolean) {
    if (blocked === next) return
    blocked = next
    deps.onAutoplayBlocked(next)
  }

  function endNudge() {
    if (nudgeUntil === null) return
    nudgeUntil = null
    if (video && state) video.playbackRate = state.rate
  }

  function seek(to: number) {
    if (!video) return
    expectSeek = { to, until: deps.now() + SEEK_ECHO_WINDOW_MS }
    video.currentTime = to
  }

  function nudge(rate: number) {
    if (!video) return
    video.playbackRate = rate
    nudgeUntil = deps.now() + NUDGE_MS
  }

  function play(target: VideoLike) {
    expectPlayUntil = deps.now() + ECHO_WINDOW_MS
    let result: Promise<void> | void
    try {
      result = target.play()
    } catch (error) {
      expectPlayUntil = 0
      if (isNotAllowed(error)) setBlocked(true)
      return
    }
    if (result && typeof result.then === 'function') {
      result.then(
        () => setBlocked(false),
        (error: unknown) => {
          expectPlayUntil = 0
          if (isNotAllowed(error)) setBlocked(true)
        },
      )
    } else {
      setBlocked(false)
    }
  }

  function apply() {
    if (!video || !state) return
    if (deps.isAd()) {
      pending = true
      return
    }
    pending = false
    endNudge()
    const plan = planSync(state, video, serverNow(), { buffering })
    if (plan.rate !== null) video.playbackRate = plan.rate
    if (plan.pause) {
      expectPauseUntil = deps.now() + ECHO_WINDOW_MS
      video.pause()
      setBlocked(false)
    }
    if (plan.seekTo !== null) seek(plan.seekTo)
    if (plan.nudgeRate !== null) nudge(plan.nudgeRate)
    if (plan.play) play(video)
  }

  function report(action: ControlAction) {
    if (!video) return
    reportedAt = deps.now()
    seeding = false
    const rate = nudgeUntil !== null && state ? state.rate : video.playbackRate
    deps.report({ action, position: video.currentTime, rate })
  }

  function seed() {
    if (!seeding || !video || deps.isAd()) return
    report(video.paused ? 'pause' : 'play')
  }

  return {
    /** Points the engine at the page's video (players can swap the element). */
    setVideo(next: VideoLike | null) {
      if (next === video) return
      video = next
      nudgeUntil = null
      if (video && state) pending = true
    },

    /**
     * A state from the room. Returns false when it is not newer than the last one.
     * `offsetMs` is the server clock minus the local clock.
     */
    receive(next: PlaybackState, offsetMs: number): boolean {
      if (next.seq <= lastSeq) return false
      lastSeq = next.seq
      clockOffsetMs = offsetMs
      if (isFreshRoom(next)) {
        // Nobody has played, paused or seeked yet (a party that was just started): the
        // room's placeholder state would yank the host back to 0:00. Seed the room from
        // this player instead; the echo comes back as a normal state.
        seeding = true
        seed()
        return true
      }
      seeding = false
      state = next
      if (!video) {
        pending = true
        return true
      }
      apply()
      return true
    },

    /** A media event from the video. */
    handleEvent(type: MediaEventType) {
      if (!video) return
      const now = deps.now()
      if (type === 'waiting' || type === 'stalled') {
        // Buffering is not a pause: nothing is sent to the room.
        buffering = true
        return
      }
      if (type === 'playing') {
        buffering = false
        return
      }
      // Never act on what happens during an ad (the player pauses and seeks around them).
      if (deps.isAd()) return

      if (type === 'play') {
        if (now < expectPlayUntil) {
          expectPlayUntil = 0
          return
        }
        if (blocked && state && !state.paused) {
          // The viewer pressed play after the browser blocked us: join the room's position.
          setBlocked(false)
          apply()
          return
        }
        report('play')
      } else if (type === 'pause') {
        if (now < expectPauseUntil) {
          expectPauseUntil = 0
          return
        }
        report('pause')
      } else if (type === 'seeked') {
        if (
          expectSeek &&
          now < expectSeek.until &&
          Math.abs(video.currentTime - expectSeek.to) < SEEK_ECHO_TOLERANCE_SECONDS
        ) {
          expectSeek = null
          return
        }
        expectSeek = null
        report('seek')
      }
    },

    /** Periodic work: applies a state held back by an ad, ends nudges, corrects drift. */
    tick() {
      if (seeding) seed()
      if (!video || !state || deps.isAd()) return
      if (pending) {
        apply()
        return
      }
      const now = deps.now()
      if (nudgeUntil !== null) {
        if (now < nudgeUntil) return
        endNudge()
      }
      if (
        state.paused ||
        video.paused ||
        buffering ||
        now - reportedAt < REPORT_GRACE_MS ||
        (expectSeek && now < expectSeek.until)
      ) {
        return
      }
      const plan = planSync(state, video, serverNow(), { buffering })
      if (plan.seekTo !== null) seek(plan.seekTo)
      else if (plan.nudgeRate !== null) nudge(plan.nudgeRate)
    },

    /** Leaves the video as the viewer would expect: normal speed, no pending work. */
    dispose() {
      endNudge()
      video = null
      state = null
      pending = false
      seeding = false
    },

    /** "Click to sync": runs inside a click, so play() is allowed this time. */
    resync() {
      setBlocked(false)
      apply()
    },

    get lastSeq() {
      return lastSeq
    },
    get autoplayBlocked() {
      return blocked
    },
    get nudging() {
      return nudgeUntil !== null
    },
  }
}

export type SyncEngine = ReturnType<typeof createSyncEngine>
