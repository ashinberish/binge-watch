import type { PlayerAdapter } from '../../adapters/types'
import type { Failure, Result } from '../../lib/result'
import type { Message, PartyTabMessage, PartyTabView, Reply } from '../../messaging/protocol'
import {
  createSyncEngine,
  MEDIA_EVENTS,
  type MediaEventType,
  type SyncEngine,
} from '../../party/engine'
import { parsePartyFragment, stripPartyFragment } from '../../party/invite'

/** Where the pill sits: the top-right corner of the video, in viewport pixels. */
export interface PillAnchor {
  top: number
  right: number
}

export type PartyOverlayView =
  /** An invite link opened this page: ask before joining. */
  | { kind: 'invite'; hostName: string; joining: boolean; error: string | null }
  /** An invite link that cannot be used. */
  | { kind: 'notice'; message: string }
  | { kind: 'pill'; label: string; needsClick: boolean; anchor: PillAnchor | null }
  | { kind: 'ended'; message: string; anchor: PillAnchor | null }

export interface PartyOverlayDeps {
  adapter: PlayerAdapter
  doc: Document
  send: <M extends Message>(message: M) => Promise<Reply<M>>
  render: (view: PartyOverlayView | null) => void
  /** Rewrites the address bar without navigating (history.replaceState). */
  replaceUrl: (url: string) => void
  now?: () => number
}

/** How long "The party has ended" stays up. */
export const ENDED_NOTICE_MS = 4_000
/** Keep the pill clear of the video's edge. */
const PILL_INSET = 12

export function membersLabel(count: number): string {
  return `Watch party · ${Math.max(1, count)} watching`
}

/** Viewer-facing sentence for an invite that cannot be used. */
export function inviteFailureMessage(error: Failure): string {
  switch (error) {
    case 'not-found':
      return 'This party has ended or the link is wrong.'
    case 'full':
      return 'This party is full.'
    case 'signed-out':
      return 'Sign in from the Nightreel button in your toolbar, then open the invite link again.'
    case 'rejected':
      return 'This invite is for a different video.'
    case 'network':
      return 'Cannot reach Nightreel. Check your connection.'
    default:
      return 'Nightreel is having trouble right now. Try again in a moment.'
  }
}

/**
 * The watch party on a player page: reads invite links, asks before joining, keeps the
 * video in step with the room (via the sync engine) and shows the quiet "N watching" pill.
 * Call `tick()` about once a second and pass media events to `mediaEvent()`.
 */
export function createPartyOverlay(deps: PartyOverlayDeps) {
  const { adapter, doc } = deps
  const now = deps.now ?? Date.now

  let party: { code: string; members: number } | null = null
  let engine: SyncEngine | null = null
  let needsClick = false
  let invite: { code: string; hostName: string; joining: boolean; error: string | null } | null =
    null
  let notice: string | null = null
  let ended: { message: string; until: number } | null = null
  let lastDrawn = 'null'

  const isAd = () => adapter.isAd?.(doc) ?? false

  function anchor(): PillAnchor | null {
    const video = adapter.findVideo(doc)
    if (!video) return null
    const rect = video.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const viewportWidth = doc.documentElement.clientWidth || rect.right
    return {
      top: Math.max(PILL_INSET, rect.top + PILL_INSET),
      right: Math.max(PILL_INSET, viewportWidth - rect.right + PILL_INSET),
    }
  }

  function view(): PartyOverlayView | null {
    if (invite) {
      const { hostName, joining, error } = invite
      return { kind: 'invite', hostName, joining, error }
    }
    if (notice) return { kind: 'notice', message: notice }
    if (party) {
      if (isAd()) return null
      return { kind: 'pill', label: membersLabel(party.members), needsClick, anchor: anchor() }
    }
    if (ended && now() < ended.until) {
      return { kind: 'ended', message: ended.message, anchor: anchor() }
    }
    ended = null
    return null
  }

  function draw() {
    const next = view()
    const key = JSON.stringify(next)
    if (key === lastDrawn) return
    lastDrawn = key
    deps.render(next)
  }

  function enter(view: PartyTabView) {
    if (party?.code !== view.code) {
      engine?.dispose()
      engine = createSyncEngine({
        now,
        isAd,
        report: (action) => {
          deps.send({ type: 'party:report', adapter: adapter.id, ...action }).catch(() => undefined)
        },
        onAutoplayBlocked: (blocked) => {
          needsClick = blocked
          draw()
        },
      })
      engine.setVideo(adapter.findVideo(doc))
    }
    party = { code: view.code, members: view.memberCount }
    invite = null
    notice = null
    ended = null
    if (view.state) engine?.receive(view.state, view.clockOffsetMs)
    draw()
  }

  function leave(message: string | null) {
    engine?.dispose()
    engine = null
    party = null
    needsClick = false
    ended = message ? { message, until: now() + ENDED_NOTICE_MS } : null
    draw()
  }

  async function ask(code: string) {
    let result: Result<PartyTabView>
    try {
      result = await deps.send({
        type: 'party:join-request',
        adapter: adapter.id,
        code,
        confirm: false,
      })
    } catch {
      return // extension reloaded or service worker unavailable
    }
    if (!result.ok) {
      notice = inviteFailureMessage(result.error)
    } else if (result.data.status === 'invited') {
      invite = { code, hostName: result.data.hostName, joining: false, error: null }
    } else {
      enter(result.data) // already in this party
    }
    draw()
  }

  return {
    /** Checks for an invite link and picks up a party this tab is already in. */
    async start() {
      this.checkInvite()
      try {
        const current = await deps.send({ type: 'party:get-for-tab' })
        if (current && current.status !== 'invited' && !party) enter(current)
      } catch {
        // Service worker unavailable: no party.
      }
    },

    /** Run on load and on every in-page navigation. */
    checkInvite() {
      const href = doc.location.href
      const code = parsePartyFragment(href)
      if (!code) return
      // Strip it first, so a reload or a copied URL does not ask again.
      deps.replaceUrl(stripPartyFragment(href))
      if (party?.code === code || invite?.code === code) return
      void ask(code)
    },

    async join() {
      if (!invite || invite.joining) return
      const { code } = invite
      invite = { ...invite, joining: true, error: null }
      draw()
      let result: Result<PartyTabView>
      try {
        result = await deps.send({
          type: 'party:join-request',
          adapter: adapter.id,
          code,
          confirm: true,
        })
      } catch {
        result = { ok: false, error: 'network' }
      }
      if (invite?.code !== code) return
      if (result.ok) enter(result.data)
      else {
        invite = { ...invite, joining: false, error: inviteFailureMessage(result.error) }
        draw()
      }
    },

    /** "Not now" on the invite, or closing a notice. */
    dismiss() {
      invite = null
      notice = null
      draw()
    },

    /** "Click to sync" after the browser blocked autoplay. */
    resync() {
      engine?.resync()
    },

    /** A message from the service worker about this tab's party. */
    receive(message: PartyTabMessage) {
      if (message.type === 'party:ended') {
        if (party?.code !== message.code) return
        leave(
          message.reason === 'ended'
            ? 'The party has ended'
            : message.reason === 'error'
              ? 'Watch party disconnected'
              : null,
        )
        return
      }
      if (party?.code !== message.code) {
        // The popup started (or rejoined) a party for this tab: pick it up.
        void deps
          .send({ type: 'party:get-for-tab' })
          .then((current) => {
            if (current && current.code === message.code && current.status !== 'invited') {
              enter(current)
            }
          })
          .catch(() => undefined)
        return
      }
      if (message.type === 'party:state') {
        engine?.receive(message.state, message.clockOffsetMs)
      } else {
        party = { ...party, members: message.count }
        draw()
      }
    },

    /** A media event from the page. Only the player's main video counts. */
    mediaEvent(type: string, target: EventTarget | null) {
      if (!engine || !(MEDIA_EVENTS as readonly string[]).includes(type)) return
      const video = adapter.findVideo(doc)
      if (!video || target !== video) return
      engine.setVideo(video)
      engine.handleEvent(type as MediaEventType)
    },

    tick() {
      if (engine) {
        engine.setVideo(adapter.findVideo(doc))
        engine.tick()
      }
      draw()
    },

    get inParty() {
      return party !== null
    },
  }
}

export type PartyOverlay = ReturnType<typeof createPartyOverlay>
