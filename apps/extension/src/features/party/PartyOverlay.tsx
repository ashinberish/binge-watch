import { Button, Icon, IconButton } from '@nightreel/ui'
import { MessageCircle, SmilePlus } from 'lucide-react'
import { useId, type CSSProperties } from 'react'

import { REACTION_KINDS, type ReactionKind } from '../../party/protocol'
import { reactionButtonLabel, type FloatingReaction } from '../../party/reactions'
import type { PartyOverlayView, PillAnchor, PillChat, StageAnchor } from './overlay'
import { REACTION_ICONS } from './reactionIcons'

interface Props {
  view: PartyOverlayView
  onJoin: () => void
  onDismiss: () => void
  onResync: () => void
  onOpenPanel?: () => void
  onToggleReactions?: () => void
  onCloseReactions?: () => void
  onReact?: (kind: ReactionKind) => void
}

/** The chat button's accessible name: "Open chat, 3 unread". */
export function chatButtonLabel(unread: number): string {
  return unread > 0 ? `Open chat, ${unread} unread` : 'Open chat'
}

/** The bubble sits under the pill, well above the player's control bar. */
const BUBBLE_GAP = 40

const bubbleStyle = (anchor: PillAnchor | null): CSSProperties | undefined =>
  anchor ? { top: `${anchor.top + BUBBLE_GAP}px`, right: `${anchor.right}px` } : undefined

function ChatCorner({
  chat,
  onOpenPanel,
  onToggleReactions,
  onCloseReactions,
  onReact,
}: {
  chat: PillChat
  onOpenPanel?: () => void
  onToggleReactions?: () => void
  onCloseReactions?: () => void
  onReact?: (kind: ReactionKind) => void
}) {
  const trayId = useId()
  return (
    <>
      <button
        type="button"
        className="nr-party-pill__chat"
        aria-label={chatButtonLabel(chat.unread)}
        onClick={onOpenPanel}
      >
        <Icon icon={MessageCircle} size="extension" />
        {chat.unread > 0 ? (
          <span className="nr-party-pill__unread" aria-hidden="true">
            <span className="nr-party-pill__dot" />
            {chat.unread > 99 ? '99+' : chat.unread}
          </span>
        ) : null}
      </button>
      <IconButton
        size="sm"
        className="nr-party-pill__icon"
        icon={SmilePlus}
        aria-label="Reactions"
        aria-expanded={chat.reactionsOpen}
        aria-controls={chat.reactionsOpen ? trayId : undefined}
        onClick={onToggleReactions}
      />
      {chat.reactionsOpen ? (
        <div
          id={trayId}
          role="group"
          aria-label="Reactions"
          className="nr-party-pill__tray"
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCloseReactions?.()
          }}
        >
          {REACTION_KINDS.map((kind) => (
            <IconButton
              key={kind}
              size="sm"
              className="nr-party-pill__icon"
              icon={REACTION_ICONS[kind]}
              aria-label={reactionButtonLabel(kind)}
              onClick={() => onReact?.(kind)}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}

/** Reactions rising from the video's bottom-right corner. Decorative: the panel has the record. */
function FloatingReactions({
  reactions,
  stage,
}: {
  reactions: FloatingReaction[]
  stage: StageAnchor | null
}) {
  if (reactions.length === 0 || !stage) return null
  return (
    <div
      className="nr-reactions"
      aria-hidden="true"
      style={{ bottom: `${stage.bottom}px`, right: `${stage.right}px` }}
    >
      {reactions.map((reaction) => (
        <span
          key={reaction.id}
          className={`nr-reaction nr-reaction--${reaction.motion}`}
          style={{ right: `${reaction.offset}px` }}
        >
          <Icon icon={REACTION_ICONS[reaction.kind]} size={28} className="nr-reaction__icon" />
          <span className="nr-reaction__name">{reaction.name}</span>
        </span>
      ))}
    </div>
  )
}

/** "Join Kai's watch party?" */
export function inviteQuestion(hostName: string): string {
  return `Join ${hostName}'s watch party?`
}

const anchorStyle = (anchor: PillAnchor | null) =>
  anchor ? { top: `${anchor.top}px`, right: `${anchor.right}px` } : undefined

/** The watch party's overlay UI, in the content script's shadow root. */
export function PartyOverlay({
  view,
  onJoin,
  onDismiss,
  onResync,
  onOpenPanel,
  onToggleReactions,
  onCloseReactions,
  onReact,
}: Props) {
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
        <>
          <div className="nr-party-pill" style={anchorStyle(view.anchor)}>
            <span role="status">{view.label}</span>
            {view.needsClick ? (
              <button type="button" className="nr-party-pill__action" onClick={onResync}>
                Click to sync
              </button>
            ) : null}
            <ChatCorner
              chat={view.chat}
              onOpenPanel={onOpenPanel}
              onToggleReactions={onToggleReactions}
              onCloseReactions={onCloseReactions}
              onReact={onReact}
            />
          </div>
          {view.chat.hint ? (
            <p className="nr-party-bubble" style={bubbleStyle(view.anchor)} role="status">
              {view.chat.hint}
            </p>
          ) : view.chat.toast ? (
            <p
              key={view.chat.toast.id}
              className="nr-party-bubble"
              style={bubbleStyle(view.anchor)}
              role="status"
            >
              {view.chat.toast.text}
            </p>
          ) : null}
          <FloatingReactions reactions={view.reactions} stage={view.stage} />
        </>
      )
    case 'ended':
      return (
        <div className="nr-party-pill" style={anchorStyle(view.anchor)}>
          <span role="status">{view.message}</span>
        </div>
      )
  }
}
