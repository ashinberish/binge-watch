import { AVATAR_COLORS } from '@nightreel/shared'
import { Avatar, Badge, Icon, IconButton, Input, type IconName } from '@nightreel/ui'
import { SendHorizontal } from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type UIEvent,
} from 'react'

import { chatInputState, relativeTime } from '../../party/chat'
import {
  CHAT_MAX_LENGTH,
  REACTION_KINDS,
  type ChatMessage,
  type MemberStatus,
  type ReactionKind,
  type RoomMember,
} from '../../party/protocol'
import { reactionButtonLabel } from '../../party/reactions'
import { REACTION_ICONS } from './reactionIcons'

/** The status words in the member list. The icon repeats the word; it never replaces it. */
export const STATUS_WORDS: Record<MemberStatus, string> = {
  watching: 'Watching',
  buffering: 'Buffering',
  ad: 'Watching an ad',
  away: 'Away',
}

const STATUS_ICONS: Record<MemberStatus, IconName> = {
  watching: 'eye',
  buffering: 'loader',
  ad: 'tv',
  away: 'moon',
}

/** A stable avatar colour per member, from the profile palette. */
export function memberColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]
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
          <Avatar name={member.display_name} color={memberColor(member.id)} size="sm" decorative />
          <span className="nr-members__name">
            {member.display_name}
            {member.id === youId ? <span className="nr-members__you"> (you)</span> : null}
          </span>
          {member.is_host ? <Badge>Host</Badge> : null}
          <span className="nr-members__status">
            <Icon icon={STATUS_ICONS[member.status]} size="extension" />
            {STATUS_WORDS[member.status]}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Within this many px of the end counts as "at the bottom". */
const BOTTOM_SLACK_PX = 24

function ChatLog({
  messages,
  youId,
  now,
}: {
  messages: ChatMessage[]
  youId: string | null
  now: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const lastId = useRef<string | null>(null)
  const [hasNew, setHasNew] = useState(false)

  const scrollToEnd = () => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
    atBottom.current = true
    setHasNew(false)
  }

  // Follow new messages only when the viewer is already at the bottom; otherwise offer a jump.
  useLayoutEffect(() => {
    const newest = messages.at(-1)?.id ?? null
    if (newest === lastId.current) return
    const first = lastId.current === null
    lastId.current = newest
    if (first || atBottom.current) scrollToEnd()
    else setHasNew(true)
  }, [messages])

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
        {messages.length === 0 ? (
          <p className="nr-panel__muted">No messages yet. Say hi to the party.</p>
        ) : (
          <ol className="nr-chat__list">
            {messages.map((message) => {
              const own = message.user.id === youId
              return (
                <li
                  key={message.id}
                  className={own ? 'nr-chat__msg nr-chat__msg--own' : 'nr-chat__msg'}
                >
                  <p className="nr-chat__meta">
                    <span className="nr-chat__name">{own ? 'You' : message.user.display_name}</span>
                    <time
                      className="nr-chat__time"
                      dateTime={new Date(message.sent_at * 1000).toISOString()}
                    >
                      {relativeTime(message.sent_at, now)}
                    </time>
                  </p>
                  {/* Plain text only: React escapes it, nothing is linkified. */}
                  <p className="nr-chat__text">{message.text}</p>
                </li>
              )
            })}
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
      <div className="nr-composer__row">
        <label htmlFor={`${id}-input`} className="nr-visually-hidden">
          Message
        </label>
        <Input
          id={`${id}-input`}
          size="sm"
          className="nr-composer__input"
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          autoComplete="off"
          placeholder="Message the party"
          disabled={disabledReason !== null}
          invalid={shownError !== null || input.tooLong}
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
          variant="secondary"
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
        <IconButton
          key={kind}
          size="sm"
          icon={REACTION_ICONS[kind]}
          aria-label={reactionButtonLabel(kind)}
          disabled={disabled}
          onClick={() => onReact(kind)}
        />
      ))}
    </div>
  )
}

/** Refresh "3 min ago" labels this often. */
const CLOCK_MS = 30_000

/** The side panel's Party tab: who is here, the chat, and reactions. */
export function PartyRoom({
  members,
  youId,
  chat,
  connection,
  error,
  onSend,
  onReact,
  onClearError,
  now = Date.now,
}: PartyRoomProps) {
  const [time, setTime] = useState(now)
  useEffect(() => {
    setTime(now())
    const timer = setInterval(() => setTime(now()), CLOCK_MS)
    return () => clearInterval(timer)
  }, [now, chat])

  return (
    <div className="nr-room">
      <section className="nr-panel__section" aria-labelledby="room-members">
        <h2 id="room-members" className="nr-season__title">
          In the party
        </h2>
        <MemberList members={members} youId={youId} />
      </section>
      <section className="nr-panel__section nr-room__chat" aria-labelledby="room-chat">
        <h2 id="room-chat" className="nr-season__title">
          Chat
        </h2>
        <ChatLog messages={chat} youId={youId} now={time} />
        <ReactionBar disabled={connection !== 'live'} onReact={onReact} />
        <Composer
          connection={connection}
          error={error}
          onSend={onSend}
          onClearError={onClearError}
        />
      </section>
    </div>
  )
}
