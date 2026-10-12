import { AVATAR_COLORS } from '@nightreel/shared'
import { Avatar, IconButton } from '@nightreel/ui'
import { SendHorizontal } from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type UIEvent,
} from 'react'

import {
  chatEntries,
  chatInputState,
  relativeTime,
  type ChatEntry,
  type SystemLine,
} from '../../party/chat'
import {
  CHAT_MAX_LENGTH,
  REACTION_KINDS,
  type ChatMessage,
  type MemberStatus,
  type ReactionKind,
  type RoomMember,
} from '../../party/protocol'
import { REACTION_EMOJI, reactionButtonLabel } from '../../party/reactions'

/** The status words in the member list. The dot repeats the word; it never replaces it. */
export const STATUS_WORDS: Record<MemberStatus, string> = {
  watching: 'Watching',
  buffering: 'Buffering',
  ad: 'Watching an ad',
  away: 'Away',
}

/** A stable avatar colour per member, from the profile palette. */
export function memberColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]
}

/**
 * A quiet 28px avatar: the person's colour at low strength behind their initials, so a
 * row of them does not shout. Pass the same colour the solid avatar would use.
 */
export function softAvatarStyle(color: string): CSSProperties {
  return {
    '--nr-avatar-bg': `color-mix(in srgb, ${color} 32%, var(--nr-color-surface-overlay))`,
    '--nr-avatar-fg': 'var(--nr-color-ink)',
  } as CSSProperties
}

/** Host first, then in the order people joined. */
export function sortMembers(members: RoomMember[]): RoomMember[] {
  return [...members].sort(
    (a, b) => Number(b.is_host) - Number(a.is_host) || a.joined_at - b.joined_at,
  )
}

/** Why the chat box is disabled, or null when it is not. */
export function chatDisabledReason(connection: PartyRoomProps['connection']): string | null {
  switch (connection) {
    case 'live':
      return null
    case 'reconnecting':
      return 'Reconnecting. You can chat again in a moment.'
    default:
      return 'Connecting to the party…'
  }
}

export interface PartyRoomProps {
  members: RoomMember[]
  youId: string | null
  chat: ChatMessage[]
  /** Local lines ("Sam switched to a new video"), shown among the messages. */
  system?: SystemLine[]
  connection: 'connecting' | 'live' | 'reconnecting'
  /** The server's last refusal ("You're sending messages too quickly."), shown under the input. */
  error: string | null
  /** Sends one message. Resolves false when it could not be sent. */
  onSend: (text: string) => Promise<boolean>
  onReact: (kind: ReactionKind) => void
  /** The viewer typed again: the old error no longer applies. */
  onClearError?: () => void
  /** Local epoch ms; injectable for tests. */
  now?: () => number
}

function MemberList({ members, youId }: { members: RoomMember[]; youId: string | null }) {
  if (members.length === 0) {
    return <p className="nr-panel__muted">Waiting for the party to connect…</p>
  }
  return (
    <ul className="nr-members" aria-label="People in the party">
      {sortMembers(members).map((member) => (
        <li key={member.id} className="nr-members__row">
          <Avatar
            name={member.display_name}
            color={memberColor(member.id)}
            style={softAvatarStyle(memberColor(member.id))}
            size="sm"
            className="nr-avatar--soft"
            decorative
          />
          <span className="nr-members__text">
            <span className="nr-members__line">
              <span className="nr-members__name">
                {member.display_name}
                {member.id === youId ? <span className="nr-members__you"> (you)</span> : null}
              </span>
              {member.is_host ? <span className="nr-members__host">Host</span> : null}
            </span>
            <span className="nr-members__status">
              <span
                className={`nr-members__dot nr-members__dot--${member.status}`}
                aria-hidden="true"
              />
              {STATUS_WORDS[member.status]}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Within this many px of the end counts as "at the bottom". */
const BOTTOM_SLACK_PX = 24

function ChatItem({ entry, now }: { entry: ChatEntry; now: number }) {
  if (entry.kind === 'system') {
    return <li className="nr-chat__system">{entry.line.text}</li>
  }
  const { message, own, head } = entry
  const name = own ? 'You' : message.user.display_name
  const classes = ['nr-chat__msg', own ? 'nr-chat__msg--own' : '', head ? 'nr-chat__msg--head' : '']
  return (
    <li className={classes.filter(Boolean).join(' ')}>
      {head ? (
        <p className="nr-chat__meta">
          {own ? (
            <span className="nr-visually-hidden">You</span>
          ) : (
            <span className="nr-chat__name">{name}</span>
          )}
          <time className="nr-chat__time" dateTime={new Date(message.sent_at * 1000).toISOString()}>
            {relativeTime(message.sent_at, now)}
          </time>
        </p>
      ) : (
        // Screen readers still hear who said a grouped message.
        <span className="nr-visually-hidden">{name}: </span>
      )}
      {/* Plain text only: React escapes it, nothing is linkified. */}
      <p className="nr-chat__text">{message.text}</p>
    </li>
  )
}

function ChatLog({
  messages,
  system,
  youId,
  now,
}: {
  messages: ChatMessage[]
  system: SystemLine[]
  youId: string | null
  now: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const lastId = useRef<string | null>(null)
  const [hasNew, setHasNew] = useState(false)
  const entries = chatEntries(messages, system, youId)

  const scrollToEnd = () => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
    atBottom.current = true
    setHasNew(false)
  }

  // Follow new messages only when the viewer is already at the bottom; otherwise offer a jump.
  const newest = entries.at(-1)
  const newestId = newest
    ? newest.kind === 'message'
      ? newest.message.id
      : `system:${newest.line.id}`
    : null
  useLayoutEffect(() => {
    if (newestId === lastId.current) return
    const first = lastId.current === null
    lastId.current = newestId
    if (first || atBottom.current) scrollToEnd()
    else setHasNew(true)
  }, [newestId])

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX
    if (atBottom.current) setHasNew(false)
  }

  return (
    <div className="nr-chat">
      <div
        ref={ref}
        className="nr-chat__log"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
        tabIndex={0}
        onScroll={onScroll}
      >
        {entries.length === 0 ? (
          <div className="nr-chat__empty">
            <p className="nr-chat__empty-title">No messages yet</p>
            <p className="nr-panel__muted">Say hi to the party.</p>
          </div>
        ) : (
          <ol className="nr-chat__list">
            {entries.map((entry) => (
              <ChatItem
                key={entry.kind === 'message' ? entry.message.id : `system:${entry.line.id}`}
                entry={entry}
                now={now}
              />
            ))}
          </ol>
        )}
      </div>
      {hasNew ? (
        <button type="button" className="nr-chat__jump" onClick={scrollToEnd}>
          New messages
        </button>
      ) : null}
    </div>
  )
}

function Composer({
  connection,
  error,
  onSend,
  onClearError,
}: Pick<PartyRoomProps, 'connection' | 'error' | 'onSend' | 'onClearError'>) {
  const id = useId()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const lastSent = useRef<string | null>(null)
  const input = chatInputState(text)
  const disabledReason = chatDisabledReason(connection)
  const shownError = localError ?? error

  // The server refused the last message (too fast, too long): give the text back.
  useEffect(() => {
    if (error && lastSent.current) {
      const restore = lastSent.current
      lastSent.current = null
      setText((current) => (current === '' ? restore : current))
    }
  }, [error])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!input.canSend || sending || disabledReason) return
    const message = text.trim()
    setSending(true)
    setLocalError(null)
    onClearError?.()
    let sent = false
    try {
      sent = await onSend(message)
    } catch {
      sent = false
    }
    setSending(false)
    if (sent) {
      lastSent.current = message
      setText('')
    } else {
      setLocalError('Your message was not sent. Try again in a moment.')
    }
  }

  const describedBy = [
    input.counterText ? `${id}-counter` : null,
    disabledReason ? `${id}-reason` : null,
    shownError ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <form className="nr-composer" onSubmit={(event) => void submit(event)}>
      <div
        className={
          shownError !== null || input.tooLong
            ? 'nr-composer__field nr-composer__field--invalid'
            : 'nr-composer__field'
        }
      >
        <label htmlFor={`${id}-input`} className="nr-visually-hidden">
          Message
        </label>
        <input
          id={`${id}-input`}
          type="text"
          className="nr-composer__input"
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          autoComplete="off"
          placeholder="Message the party"
          disabled={disabledReason !== null}
          aria-invalid={shownError !== null || input.tooLong || undefined}
          aria-describedby={describedBy || undefined}
          onChange={(event) => {
            setText(event.currentTarget.value)
            if (shownError) {
              setLocalError(null)
              onClearError?.()
            }
          }}
        />
        <IconButton
          type="submit"
          size="sm"
          className="nr-composer__send"
          icon={SendHorizontal}
          aria-label="Send message"
          disabled={!input.canSend || sending || disabledReason !== null}
        />
      </div>
      {input.counterText ? (
        <p
          id={`${id}-counter`}
          className={input.tooLong ? 'nr-composer__note nr-panel__error' : 'nr-composer__note'}
          aria-live="polite"
        >
          {input.counterText}
        </p>
      ) : null}
      {disabledReason ? (
        <p id={`${id}-reason`} className="nr-composer__note">
          {disabledReason}
        </p>
      ) : null}
      {shownError ? (
        <p id={`${id}-error`} className="nr-composer__note nr-panel__error" role="alert">
          {shownError}
        </p>
      ) : null}
    </form>
  )
}

function ReactionBar({
  disabled,
  onReact,
}: {
  disabled: boolean
  onReact: (kind: ReactionKind) => void
}) {
  return (
    <div className="nr-reaction-bar" role="group" aria-label="Reactions">
      {REACTION_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className="nr-reaction-bar__button"
          aria-label={reactionButtonLabel(kind)}
          disabled={disabled}
          onClick={() => onReact(kind)}
        >
          <span className="nr-emoji" aria-hidden="true">
            {REACTION_EMOJI[kind]}
          </span>
        </button>
      ))}
    </div>
  )
}

/** Refresh "3 min ago" labels this often. */
const CLOCK_MS = 30_000

export type PartyChatProps = Omit<PartyRoomProps, 'members'>

/** The side panel's Chat tab: the log fills the height, reactions and the box sit at the bottom. */
export function PartyChat({
  youId,
  chat,
  system = [],
  connection,
  error,
  onSend,
  onReact,
  onClearError,
  now = Date.now,
}: PartyChatProps) {
  const [time, setTime] = useState(now)
  useEffect(() => {
    setTime(now())
    const timer = setInterval(() => setTime(now()), CLOCK_MS)
    return () => clearInterval(timer)
  }, [now, chat, system])

  return (
    <section className="nr-room__chat" aria-label="Chat">
      <ChatLog messages={chat} system={system} youId={youId} now={time} />
      <div className="nr-room__compose">
        <ReactionBar disabled={connection !== 'live'} onReact={onReact} />
        <Composer
          connection={connection}
          error={error}
          onSend={onSend}
          onClearError={onClearError}
        />
      </div>
    </section>
  )
}

/** The side panel's Members tab list: who is here, with host and status. */
export function PartyMembers({ members, youId }: { members: RoomMember[]; youId: string | null }) {
  return (
    <section className="nr-panel__section" aria-label="People in the party">
      <MemberList members={members} youId={youId} />
    </section>
  )
}

/** Members and chat together, for places with room for both. */
export function PartyRoom(props: PartyRoomProps) {
  return (
    <div className="nr-room">
      <PartyMembers members={props.members} youId={props.youId} />
      <PartyChat {...props} />
    </div>
  )
}
