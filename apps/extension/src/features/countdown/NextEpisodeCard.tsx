import { Button, Countdown } from '@nightreel/ui'
import { episodeLabel } from '@nightreel/shared'

import type { NextEpisode } from '../../lib/types'

interface Props {
  next: NextEpisode
  /** Ring length in seconds. When it runs out, `onPlay` fires. */
  seconds: number
  /** Holds the countdown, e.g. while the video is paused. */
  paused?: boolean
  onPlay: () => void
  onDismiss: () => void
}

/** "Up next · S1 · E3 — Title" */
export function nextEpisodeLine(next: NextEpisode): string {
  return `Up next · ${episodeLabel(next.season_number, next.episode_number)} — ${next.title}`
}

/** Card shown over the player near the end of an episode, in the content script's shadow root. */
export function NextEpisodeCard({ next, seconds, paused = false, onPlay, onDismiss }: Props) {
  const line = nextEpisodeLine(next)
  return (
    <section className="nr-next-card" aria-label="Next episode">
      <Countdown seconds={seconds} paused={paused} onComplete={onPlay} />
      <p className="nr-next-card__title">{line}</p>
      <div className="nr-next-card__actions">
        <Button size="sm" variant="secondary" onClick={onDismiss}>
          Not now
        </Button>
        <Button size="sm" variant="primary" onClick={onPlay}>
          Next episode
        </Button>
      </div>
    </section>
  )
}
