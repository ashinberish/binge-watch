import type { PlayerAdapter } from '../../adapters/types'
import type { MatchResult, NextEpisode } from '../../lib/types'
import { dismissCountdown, initialCountdown, nextCountdown, type CountdownState } from './trigger'

export interface OverlayView {
  /** Changes per episode so the countdown ring starts fresh. */
  key: string
  next: NextEpisode
  seconds: number
  paused: boolean
}

export interface CountdownControllerDeps {
  adapter: PlayerAdapter
  doc: Document
  /** Asks the service worker which catalog episode is playing. Null when unknown or signed out. */
  lookup: (adapter: PlayerAdapter, video: HTMLVideoElement) => Promise<MatchResult | null>
  countdownSeconds: () => number
  render: (view: OverlayView | null) => void
}

/**
 * Glue between the player and the next-episode card. Call `tick()` about once a second
 * and on `ended`; it looks the episode up once per episode and renders the card when
 * the trigger logic says so.
 */
export function createCountdownController(deps: CountdownControllerDeps) {
  const { adapter, doc } = deps
  let state: CountdownState = initialCountdown
  let lookedUp: string | null = null
  let match: MatchResult | null = null
  let rendered = false

  function show(view: OverlayView | null) {
    if (!view && !rendered) return
    rendered = view !== null
    deps.render(view)
  }

  function tick() {
    const video = adapter.findVideo(doc)
    const snapshot = video ? adapter.snapshot(doc, video) : null
    const key = snapshot?.externalId ?? null

    if (video && key && key !== lookedUp) {
      lookedUp = key
      match = null
      void deps.lookup(adapter, video).then((found) => {
        if (lookedUp === key) match = found
      })
    }

    const isAd = adapter.isAd?.(doc) ?? false
    state = nextCountdown(state, {
      episodeKey: key,
      remainingSeconds: video ? video.duration - video.currentTime : Number.NaN,
      ended: video?.ended ?? false,
      countdownSeconds: deps.countdownSeconds(),
      hasNext: match?.next_episode != null,
      isAd,
    })

    const next = match?.next_episode
    if (state.phase === 'showing' && next && key) {
      show({ key, next, seconds: state.seconds, paused: !!video?.paused && !video.ended })
    } else {
      show(null)
    }
  }

  function dismiss() {
    state = dismissCountdown(state)
    show(null)
  }

  function playNext() {
    dismiss()
    adapter.playNext?.(doc)
  }

  return { tick, dismiss, playNext }
}
