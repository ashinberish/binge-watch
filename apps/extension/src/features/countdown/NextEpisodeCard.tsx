import { Button, Countdown } from '@nightreel/ui'

import { useCountdown } from './useCountdown'

interface Props {
  seconds: number
  nextLabel: string
  onPlay: () => void
  onDismiss: () => void
}

export function NextEpisodeCard({ seconds, nextLabel, onPlay, onDismiss }: Props) {
  const left = useCountdown(seconds, onPlay)

  return (
    <div className="nr-next-card" role="dialog" aria-label="Next episode">
      <Countdown seconds={seconds} />
      <div className="nr-next-card__body">
        <p className="nr-next-card__title">Next episode in {left ?? seconds}s</p>
        <p className="nr-next-card__meta">{nextLabel}</p>
      </div>
      <div className="nr-next-card__actions">
        <Button size="sm" variant="secondary" onClick={onDismiss}>
          Not now
        </Button>
        <Button size="sm" variant="primary" onClick={onPlay}>
          Next episode
        </Button>
      </div>
    </div>
  )
}
