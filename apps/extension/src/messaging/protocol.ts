import type { PlaybackSnapshot } from '../adapters/types'

/** Every message between contexts is one of these. The service worker answers. */
export type Message =
  | { type: 'progress'; adapter: string; snapshot: PlaybackSnapshot }
  | { type: 'session:get' }
  | { type: 'session:sign-in' }
  | { type: 'session:sign-out' }

export interface SessionState {
  signedIn: boolean
  displayName: string | null
}

export type Reply<M extends Message> = M extends { type: 'session:get' | 'session:sign-in' }
  ? SessionState
  : { ok: boolean }

export function send<M extends Message>(message: M): Promise<Reply<M>> {
  return chrome.runtime.sendMessage(message)
}
