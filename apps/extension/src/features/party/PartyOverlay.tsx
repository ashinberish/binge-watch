import { Button } from '@nightreel/ui'

import type { PartyOverlayView, PillAnchor } from './overlay'

interface Props {
  view: PartyOverlayView
  onJoin: () => void
  onDismiss: () => void
  onResync: () => void
}

/** "Join Kai's watch party?" */
export function inviteQuestion(hostName: string): string {
  return `Join ${hostName}'s watch party?`
}

const anchorStyle = (anchor: PillAnchor | null) =>
  anchor ? { top: `${anchor.top}px`, right: `${anchor.right}px` } : undefined

/** The watch party's overlay UI, in the content script's shadow root. */
export function PartyOverlay({ view, onJoin, onDismiss, onResync }: Props) {
  switch (view.kind) {
    case 'invite':
      return (
        <section className="nr-next-card nr-party-card" aria-label="Watch party invite">
          <div className="nr-party-card__text">
            <p className="nr-next-card__title">{inviteQuestion(view.hostName)}</p>
            <p className="nr-party-card__muted">
              Everyone in the party can play, pause and skip for the whole group.
            </p>
            {view.error ? (
              <p className="nr-party-card__error" role="alert">
                {view.error}
              </p>
            ) : null}
          </div>
          <div className="nr-next-card__actions">
            <Button size="sm" variant="secondary" onClick={onDismiss} disabled={view.joining}>
              Not now
            </Button>
            <Button size="sm" variant="primary" onClick={onJoin} loading={view.joining}>
              Join
            </Button>
          </div>
        </section>
      )
    case 'notice':
      return (
        <section className="nr-next-card nr-party-card" aria-label="Watch party invite">
          <p className="nr-party-card__text" role="status">
            {view.message}
          </p>
          <div className="nr-next-card__actions">
            <Button size="sm" variant="secondary" onClick={onDismiss}>
              Close
            </Button>
          </div>
        </section>
      )
    case 'pill':
      return (
        <div className="nr-party-pill" style={anchorStyle(view.anchor)}>
          <span role="status">{view.label}</span>
          {view.needsClick ? (
            <button type="button" className="nr-party-pill__action" onClick={onResync}>
              Click to sync
            </button>
          ) : null}
        </div>
      )
    case 'ended':
      return (
        <div className="nr-party-pill" style={anchorStyle(view.anchor)}>
          <span role="status">{view.message}</span>
        </div>
      )
  }
}
