import { CHAT_HISTORY_LIMIT, CHAT_MAX_LENGTH, type ChatMessage } from './protocol'

/**
 * A tab's chat as the service worker keeps it: the last 50 messages (like the server)
 * and how many arrived from others while nobody was reading the Party tab.
 */
export interface ChatLog {
  messages: ChatMessage[]
  unread: number
}

export const emptyChatLog = (): ChatLog => ({ messages: [], unread: 0 })

const capped = (messages: ChatMessage[]): ChatMessage[] =>
  messages.length > CHAT_HISTORY_LIMIT ? messages.slice(-CHAT_HISTORY_LIMIT) : messages

export interface AddOptions {
  /** This viewer's member id: their own messages never count as unread. */
  selfId: string | null
  /** The Party tab is on screen for this tab, so the message is read as it arrives. */
  reading: boolean
}

/**
 * Adds one message. A message already in the log (same id, e.g. replayed after a
 * reconnect) is ignored: `added` is false and the log is returned unchanged.
 */
export function addChatMessage(
  log: ChatLog,
  message: ChatMessage,
  { selfId, reading }: AddOptions,
): { log: ChatLog; added: boolean } {
  if (log.messages.some((m) => m.id === message.id)) return { log, added: false }
  const unread = reading || message.user.id === selfId ? log.unread : log.unread + 1
  return { log: { messages: capped([...log.messages, message]), unread }, added: true }
}

/**
 * The history from a (re)connect's welcome, merged with what we already had so a
 * reconnect neither duplicates nor loses messages. Ordered by send time, oldest first.
 */
export function mergeChatHistory(log: ChatLog, history: ChatMessage[]): ChatLog {
  const byId = new Map<string, ChatMessage>()
  for (const message of log.messages) byId.set(message.id, message)
  for (const message of history) byId.set(message.id, message)
  const messages = [...byId.values()].sort((a, b) => a.sent_at - b.sent_at)
  return { messages: capped(messages), unread: log.unread }
}

export const markChatRead = (log: ChatLog): ChatLog =>
  log.unread === 0 ? log : { ...log, unread: 0 }

/** Show the "N characters left" counter once this close to the limit. */
export const CHAT_COUNTER_THRESHOLD = 50

export interface ChatInputState {
  /** Characters typed (UTF-16 units, as the input's maxLength counts them). */
  length: number
  remaining: number
  showCounter: boolean
  /** "12 characters left", or null while the counter is hidden. */
  counterText: string | null
  tooLong: boolean
  /** Something other than whitespace, within the limit. */
  canSend: boolean
}

/** What the chat box should show for its current text. */
export function chatInputState(text: string): ChatInputState {
  const length = text.length
  const remaining = CHAT_MAX_LENGTH - length
  const showCounter = remaining <= CHAT_COUNTER_THRESHOLD
  const tooLong = remaining < 0
  const counterText = !showCounter
    ? null
    : tooLong
      ? `${-remaining} ${-remaining === 1 ? 'character' : 'characters'} over the limit`
      : `${remaining} ${remaining === 1 ? 'character' : 'characters'} left`
  return {
    length,
    remaining,
    showCounter,
    counterText,
    tooLong,
    canSend: !tooLong && text.trim().length > 0,
  }
}

/**
 * Text to send, or null when it should not be sent: trimmed, not empty, at most 500
 * characters. The server cleans control characters itself; this is the first gate.
 */
export function cleanChatText(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > CHAT_MAX_LENGTH) return null
  return trimmed
}

/** "now", "3 min ago", "2 h ago", "4 d ago". `sentAt` is epoch seconds, `nowMs` epoch ms. */
export function relativeTime(sentAt: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000 - sentAt))
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

/** Shortens to `max` characters with an ellipsis, on whole code points. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  if (chars.length <= max) return chars.join('')
  return `${chars
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`
}
