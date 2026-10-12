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
import type { PlaybackState, ReactionKind } from '../../party/protocol'
import { createReactionQueue, type FloatingReaction } from '../../party/reactions'
import { createStatusReporter, deriveStatus } from '../../party/status'
import { createToastQueue, type ChatToast } from '../../party/toasts'

/** Where the pill sits: the top-right corner of the video, in viewport pixels. */
export interface PillAnchor {
  top: number
  right: number
}

/** Where floating reactions start: the video's bottom-right, above its control bar. */
export interface StageAnchor {
  bottom: number
  right: number
}

/** The pill's chat and reactions corner. */
export interface PillChat {
  /** Chat messages from others not yet seen in the side panel. */
  unread: number
  panelOpen: boolean
  /** The six reaction buttons are showing. */
  reactionsOpen: boolean
  /** "Sam: that ending", while the side panel is closed. */
  toast: ChatToast | null
  /** The side panel could not be opened from the page: tell the viewer how. */
  hint: string | null
  /** "Sam switched to a new video", briefly. */
  note: string | null
}

export type PartyOverlayView =
  /** An invite link opened this page: ask before joining. */
  | { kind: 'invite'; hostName: string; joining: boolean; error: string | null }
  /** An invite link that cannot be used. */
  | { kind: 'notice'; message: string }
  | {
      kind: 'pill'
      label: string
      needsClick: boolean
      anchor: PillAnchor | null
      chat: PillChat
      reactions: FloatingReaction[]
      stage: StageAnchor | null
    }
  | { kind: 'ended'; message: string; anchor: PillAnchor | null }

export interface PartyOverlayDeps {
  adapter: PlayerAdapter
  doc: Document
  send: <M extends Message>(message: M) => Promise<Reply<M>>
  render: (view: PartyOverlayView | null) => void
  /** Rewrites the address bar without navigating (history.replaceState). */
  replaceUrl: (url: string) => void
  now?: () => number
  /** prefers-reduced-motion: reactions fade in place instead of floating up. */
  reducedMotion?: () => boolean
}

/** How long "The party has ended" stays up. */
export const ENDED_NOTICE_MS = 4_000
/** Keep the pill clear of the video's edge. */
const PILL_INSET = 12
/** Floating reactions start this far above the video's bottom edge, clear of its controls. */
const CONTROLS_CLEARANCE = 72
/** How long "Open the side panel to chat" stays up. */
export const PANEL_HINT_MS = 4_000
export const PANEL_HINT = 'Open the side panel to chat'
/** How long "Sam switched to a new video" stays under the pill. */
export const NOTE_MS = 4_000

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

  let party: { code: string; members: number; watchUrl: string } | null = null
  /** The room's latest state, applied once the page shows the party's video. */
  let latest: { state: PlaybackState; offsetMs: number } | null = null
  /** The video the engine is following; another one on the page starts it afresh. */
  let fedFor: string | null = null
  let note: { text: string; until: number } | null = null
  let engine: SyncEngine | null = null
  let needsClick = false
  let invite: { code: string; hostName: string; joining: boolean; error: string | null } | null =
    null
  let notice: string | null = null
  let ended: { message: string; until: number } | null = null
  let lastDrawn = 'null'
  let unread = 0
  let panelOpen = false
  let reactionsOpen = false
  let hintUntil = 0
  let hiddenSince: number | null = null

  const isAd = () => adapter.isAd?.(doc) ?? false
  /** The page shows the party's video (not the old one, mid-switch, or another one). */
  const onPartyVideo = () =>
    party !== null && adapter.watchUrl(doc.location.href) === party.watchUrl

  /**
   * Gives the engine the room's latest state, but only while the page plays the party's
   * video. A new video (after a switch, or the viewer picking one) resets the engine first.
   */
  function feed() {
    if (!engine || !party || !onPartyVideo()) return
    if (fedFor !== party.watchUrl) {
      engine.reset()
      fedFor = party.watchUrl
    }
    if (latest) engine.receive(latest.state, latest.offsetMs)
  }
  const reducedMotion =
    deps.reducedMotion ??
    (() => doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const reactions = createReactionQueue({ now, reducedMotion })
  const toasts = createToastQueue({ now })
  const status = createStatusReporter({
    send: (next) => {
      deps.send({ type: 'party:status', adapter: adapter.id, status: next }).catch(() => undefined)
    },
  })

  /** Derives this viewer's status from the player and the page, and reports changes. */
  function updateStatus() {
    if (!party) return
    if (doc.visibilityState === 'hidden') hiddenSince ??= now()
    else hiddenSince = null
    status.update(
      deriveStatus({
        isAd: isAd(),
        buffering: engine?.buffering ?? false,
        hiddenSince,
        now: now(),
      }),
    )
  }

  function stage(): StageAnchor | null {
    const video = adapter.findVideo(doc)
    if (!video) return null
    const rect = video.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const bottom = rect.bottom ?? rect.top + rect.height
    const viewportWidth = doc.documentElement.clientWidth || rect.right
    const viewportHeight = doc.documentElement.clientHeight || bottom
    return {
      bottom: Math.max(PILL_INSET, viewportHeight - bottom + CONTROLS_CLEARANCE),
      right: Math.max(PILL_INSET, viewportWidth - rect.right + PILL_INSET * 2),
    }
  }

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
      // A bubble in fullscreen would sit on the player's own controls: chat waits in the panel.
      const toast = panelOpen || doc.fullscreenElement ? null : toasts.current
      const floating = reactions.active()
      return {
        kind: 'pill',
        label: membersLabel(party.members),
        needsClick,
        anchor: anchor(),
        chat: {
          unread: panelOpen ? 0 : unread,
          panelOpen,
          reactionsOpen,
          toast,
          hint: now() < hintUntil ? PANEL_HINT : null,
          note: note && now() < note.until ? note.text : null,
        },
        reactions: floating,
        stage: floating.length > 0 ? stage() : null,
      }
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
    unread = view.unread
    panelOpen = view.panelOpen
    if (party?.code !== view.code) {
      status.reset()
      reactions.clear()
      toasts.clear()
      reactionsOpen = false
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
      fedFor = null
      latest = null
      note = null
    }
    party = { code: view.code, members: view.memberCount, watchUrl: view.watchUrl }
    invite = null
    notice = null
    ended = null
    if (view.state) latest = { state: view.state, offsetMs: view.clockOffsetMs }
    feed()
    updateStatus()
    draw()
  }

  function leave(message: string | null) {
    engine?.dispose()
    engine = null
    party = null
    latest = null
    fedFor = null
    note = null
    needsClick = false
    status.dispose()
    status.reset()
    reactions.clear()
    toasts.clear()
    reactionsOpen = false
    unread = 0
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
      switch (message.type) {
        case 'party:state':
          latest = { state: message.state, offsetMs: message.clockOffsetMs }
          feed()
          return
        case 'party:video':
          if (message.watchUrl !== party.watchUrl) {
            // The old video's state means nothing for the new one; its state follows.
            party = { ...party, watchUrl: message.watchUrl }
            latest = null
            needsClick = false
          }
          feed()
          break
        case 'party:system':
          if (message.pill) note = { text: message.line.text, until: now() + NOTE_MS }
          break
        case 'party:members':
          party = { ...party, members: message.count }
          break
        case 'party:chat':
          unread = message.unread
          panelOpen = message.panelOpen
          if (!panelOpen) toasts.push(message.message)
          break
        case 'party:unread':
          unread = message.unread
          panelOpen = message.panelOpen
          if (panelOpen) toasts.clear()
          break
        case 'party:reaction':
          // Never over an ad.
          if (!isAd()) reactions.add(message.reaction)
          break
        default:
          // Presence and errors are for the side panel.
          return
      }
      draw()
    },

    /** The pill's reaction button: shows or hides the six reactions. */
    toggleReactions() {
      reactionsOpen = !reactionsOpen
      draw()
    },

    closeReactions() {
      if (!reactionsOpen) return
      reactionsOpen = false
      draw()
    },

    react(kind: ReactionKind) {
      if (!party) return
      deps.send({ type: 'party:react', kind }).catch(() => undefined)
    },

    /**
     * The pill's chat button. The service worker opens the side panel while this click's
     * gesture is current; where Chrome does not allow that, the pill says how instead.
     */
    async openPanel() {
      let opened = false
      try {
        opened = (await deps.send({ type: 'party:open-panel' })).ok
      } catch {
        opened = false
      }
      if (!opened) {
        hintUntil = now() + PANEL_HINT_MS
        draw()
      }
    },

    /** The page was hidden or shown (visibilitychange). */
    visibilityChanged() {
      updateStatus()
    },

    /** A media event from the page. Only the player's main video counts. */
    mediaEvent(type: string, target: EventTarget | null) {
      if (!engine || !(MEDIA_EVENTS as readonly string[]).includes(type)) return
      // Mid-switch the page still plays the old video: nothing it does is the room's.
      if (!onPartyVideo()) return
      const video = adapter.findVideo(doc)
      if (!video || target !== video) return
      engine.setVideo(video)
      engine.handleEvent(type as MediaEventType)
      if (type === 'waiting' || type === 'stalled' || type === 'playing') updateStatus()
    },

    tick() {
      if (engine) {
        engine.setVideo(adapter.findVideo(doc))
        feed()
        if (onPartyVideo()) engine.tick()
      }
      updateStatus()
      toasts.advance()
      reactions.prune()
      draw()
    },

    get inParty() {
      return party !== null
    },
  }
}

export type PartyOverlay = ReturnType<typeof createPartyOverlay>
