import { useCallback, useEffect, useRef, useState } from 'react'

import { PANEL_PORT, type PanelReport } from '../../background/panels'
import { onBroadcast, send, type PartyTabView } from '../../messaging/protocol'
import { addChatMessage, addSystemLine, emptyChatLog } from '../../party/chat'
import type { ReactionKind } from '../../party/protocol'

/**
 * The active tab's watch party for the side panel: loads it, follows live events from
 * the service worker (presence, chat, server errors) and sends chat and reactions.
 */
export function usePartyRoom(tabId: number | null) {
  const [view, setView] = useState<PartyTabView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tabRef = useRef(tabId)
  tabRef.current = tabId

  const load = useCallback(async () => {
    const id = tabRef.current
    if (id === null) {
      setView(null)
      return
    }
    try {
      const party = await send({ type: 'party:get-for-tab', tabId: id })
      if (tabRef.current === id) setView(party && party.status !== 'invited' ? party : null)
    } catch {
      if (tabRef.current === id) setView(null)
    }
  }, [])

  useEffect(() => {
    setError(null)
    void load()
  }, [tabId, load])

  useEffect(
    () =>
      onBroadcast((message) => {
        if (message.type === 'session:changed') {
          void load()
          return
        }
        if (message.type === 'episode:changed' || message.tabId !== tabRef.current) return
        switch (message.type) {
          case 'party:changed':
            void load()
            break
          case 'party:presence':
            setView((v) => (v && v.code === message.code ? { ...v, members: message.members } : v))
            break
          case 'party:chat':
            setView((v) => {
              if (!v || v.code !== message.code) return v
              const { log } = addChatMessage(
                { ...emptyChatLog(), messages: v.chat },
                message.message,
                { selfId: v.youId, reading: true },
              )
              return { ...v, chat: log.messages, unread: message.unread }
            })
            break
          case 'party:unread':
            setView((v) => (v && v.code === message.code ? { ...v, unread: message.unread } : v))
            break
          case 'party:system':
            setView((v) =>
              v && v.code === message.code
                ? { ...v, system: addSystemLine(v.system, message.line) }
                : v,
            )
            break
          case 'party:error':
            setError(message.detail)
            break
          default:
            break
        }
      }),
    [load],
  )

  const sendChat = useCallback(async (text: string) => {
    const id = tabRef.current
    if (id === null) return false
    const reply = await send({ type: 'party:send-chat', tabId: id, text })
    return reply.ok
  }, [])

  const react = useCallback((kind: ReactionKind) => {
    const id = tabRef.current
    if (id === null) return
    send({ type: 'party:react', tabId: id, kind }).catch(() => undefined)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { view, error, sendChat, react, clearError }
}

/**
 * Keeps the service worker told which tab this panel shows and whether the Party tab is
 * on screen, over a port that closes with the panel. That is how the pill knows to show
 * chat bubbles only while the panel is closed, and how unread counts reset.
 */
export function usePanelPresence(tabId: number | null, reading: boolean) {
  const port = useRef<chrome.runtime.Port | null>(null)
  const report = useRef<PanelReport>({ type: 'panel:view', tabId, reading })
  report.current = { type: 'panel:view', tabId, reading }

  useEffect(() => {
    let closed = false
    const connect = () => {
      if (closed) return
      try {
        const next = chrome.runtime.connect({ name: PANEL_PORT })
        port.current = next
        // A restarted service worker drops the port: connect again and resend.
        next.onDisconnect.addListener(() => {
          port.current = null
          setTimeout(connect, 1_000)
        })
        next.postMessage(report.current)
      } catch {
        port.current = null
      }
    }
    connect()
    return () => {
      closed = true
      port.current?.disconnect()
      port.current = null
    }
  }, [])

  useEffect(() => {
    try {
      port.current?.postMessage({ type: 'panel:view', tabId, reading } satisfies PanelReport)
    } catch {
      // The port is reconnecting; it sends the current view when it is back.
    }
    if (reading && tabId !== null) {
      send({ type: 'party:mark-read', tabId }).catch(() => undefined)
    }
  }, [tabId, reading])
}

/** True while the panel's document is visible (the panel is open and not hidden). */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}
