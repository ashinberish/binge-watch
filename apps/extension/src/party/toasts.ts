import { truncate } from './chat'
import type { ChatMessage } from './protocol'

/** How long one chat bubble stays next to the pill. */
export const CHAT_TOAST_MS = 4_000
/** Bubbles longer than this are cut with an ellipsis. */
export const CHAT_TOAST_MAX_CHARS = 80
/** Waiting bubbles beyond this are dropped (oldest first): a busy chat belongs in the panel. */
export const CHAT_TOAST_QUEUE = 3

export interface ChatToast {
  id: string
  /** "Sam: that ending", already truncated. */
  text: string
}

/** "Sam: that ending", cut to 80 characters. */
export function toastText(message: ChatMessage): string {
  return truncate(`${message.user.display_name}: ${message.text}`, CHAT_TOAST_MAX_CHARS)
}

/** One chat bubble at a time over the player, the rest queued. */
export function createToastQueue({
  now,
  durationMs = CHAT_TOAST_MS,
  maxQueued = CHAT_TOAST_QUEUE,
}: {
  now: () => number
  durationMs?: number
  maxQueued?: number
}) {
  let current: { toast: ChatToast; until: number } | null = null
  let queue: ChatToast[] = []

  /** Moves the queue along. True when the bubble on screen changed. */
  function advance(): boolean {
    const time = now()
    if (current && time < current.until) return false
    const next = queue.shift()
    const changed = current !== null || next !== undefined
    current = next ? { toast: next, until: time + durationMs } : null
    return changed
  }

  return {
    push(message: ChatMessage) {
      const toast = { id: message.id, text: toastText(message) }
      if (current?.toast.id === toast.id || queue.some((t) => t.id === toast.id)) return
      queue = [...queue, toast].slice(-maxQueued)
      advance()
    },
    advance,
    clear() {
      current = null
      queue = []
    },
    get current(): ChatToast | null {
      return current && now() < current.until ? current.toast : null
    },
  }
}
