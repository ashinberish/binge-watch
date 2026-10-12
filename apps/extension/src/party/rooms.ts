import { adapterFor } from '../adapters/registry'
import { fail, ok, type Result } from '../lib/result'
import {
  addChatMessage,
  addSystemLine,
  emptyChatLog,
  markChatRead,
  mergeChatHistory,
  type ChatLog,
  type SystemLine,
} from './chat'
import type { ConnectionStatus, EndReason, PartyConnection, WelcomeExtras } from './connection'
import type { LocalAction } from './engine'
import type {
  ChatMessage,
  MemberStatus,
  PartyMember,
  PartyVideo,
  PlaybackState,
  Reaction,
  ReactionKind,
  RoomMember,
} from './protocol'

/**
 * The fields of the API's PartyRead the extension uses. Kept structural so the
 * generated type is assignable to it.
 */
export interface PartyInfo {
  code: string
  invite_url: string
  provider: string
  watch_url: string
  host: { display_name: string }
  member_count: number
}

export interface PartyCreateBody {
  provider: string
  watch_url: string
  episode_id: string | null
}

export interface PartyApi {
  create(body: PartyCreateBody): Promise<Result<PartyInfo>>
  get(code: string): Promise<Result<PartyInfo>>
  join(code: string): Promise<Result<PartyInfo>>
  leave(code: string): Promise<Result<unknown>>
}

/** What a tab's party looks like to the popup and the content script. */
export interface PartyTabView {
  code: string
  inviteUrl: string
  hostName: string
  provider: string
  watchUrl: string
  memberCount: number
  /** `invited`: a preview from an invite link, not joined yet. */
  status: 'invited' | ConnectionStatus
  state: PlaybackState | null
  /** Server clock minus local clock, in ms. */
  clockOffsetMs: number
  /** Everyone in the room, from the latest presence. Empty until the welcome. */
  members: RoomMember[]
  /** This viewer's member id in the room, once welcomed. */
  youId: string | null
  /** Recent chat, oldest first (at most 50). */
  chat: ChatMessage[]
  /** Lines the extension added to the chat itself ("Sam switched to a new video"). */
  system: SystemLine[]
  /** Messages from others since the Party tab was last on screen for this tab. */
  unread: number
  /** The side panel is open on this tab. */
  panelOpen: boolean
}

/** Live room events, for the tab's content script and for open extension pages. */
export type PartyLiveMessage =
  | { type: 'party:presence'; code: string; members: RoomMember[] }
  | { type: 'party:chat'; code: string; message: ChatMessage; unread: number; panelOpen: boolean }
  | { type: 'party:reaction'; code: string; reaction: Reaction }
  /** The server refused something (e.g. "You're sending messages too quickly."). */
  | { type: 'party:error'; code: string; detail: string }
  | { type: 'party:unread'; code: string; unread: number; panelOpen: boolean }
  /**
   * A local line for the chat. `pill` also shows it briefly over the player (not for the
   * viewer's own video change, which they just made).
   */
  | { type: 'party:system'; code: string; line: SystemLine; pill: boolean }

/** Background → content script, for the tab in the party. */
export type PartyTabMessage =
  | { type: 'party:state'; code: string; state: PlaybackState; clockOffsetMs: number }
  | { type: 'party:members'; code: string; count: number }
  | { type: 'party:ended'; code: string; reason: 'ended' | 'left' | 'error' }
  /** The party's video is now this canonical URL; room states are for it. Sent before them. */
  | { type: 'party:video'; code: string; watchUrl: string }
  | PartyLiveMessage

/** Persisted per tab so a restarted service worker can reconnect. */
export interface StoredParty {
  code: string
  inviteUrl: string
  hostName: string
  provider: string
  watchUrl: string
}

export interface ConnectionHandlers {
  onWelcome: (
    state: PlaybackState,
    members: number,
    you: PartyMember,
    extras?: WelcomeExtras,
  ) => void
  onState: (state: PlaybackState) => void
  onMembers: (count: number) => void
  onPresence: (members: RoomMember[]) => void
  onChat: (message: ChatMessage) => void
  onReaction: (reaction: Reaction) => void
  onVideo: (video: PartyVideo, by: PartyMember | null, seq: number) => void
  onError: (detail: string) => void
  onStatus: (status: ConnectionStatus) => void
  onEnd: (reason: EndReason) => void
}

export interface PartyRoomsDeps {
  api: PartyApi
  /** Opens (and starts) a connection for a party. */
  connect: (code: string, handlers: ConnectionHandlers) => PartyConnection
  sendToTab: (tabId: number, message: PartyTabMessage) => void
  /** Tells open extension pages (the popup) that a tab's party changed. */
  notifyChanged: (tabId: number) => void
  /** Tells open extension pages (the side panel) about a live room event. */
  notifyLive?: (tabId: number, message: PartyLiveMessage) => void
  /** Whether a side panel shows this tab, and whether it shows the Party tab. */
  panelFor?: (tabId: number) => PanelView
  tabUrl: (tabId: number) => Promise<string | null>
  /** Catalog episode id for what the tab plays, if matched. */
  episodeIdForTab: (tabId: number) => Promise<string | null>
  /** Catalog episode id for a watch URL, if it is already known (no network). */
  episodeIdForUrl?: (provider: string, watchUrl: string) => Promise<string | null>
  /** Loads a URL in the tab (chrome.tabs.update). */
  navigateTab: (tabId: number, url: string) => Promise<void>
  /** Local epoch ms. */
  now?: () => number
  load: () => Promise<Record<string, StoredParty>>
  save: (parties: Record<string, StoredParty>) => Promise<void>
}

/** What the side panel shows for a tab. */
export interface PanelView {
  open: boolean
  /** The Party tab is on screen, so chat arriving now is read. */
  reading: boolean
}

const NO_PANEL: PanelView = { open: false, reading: false }

/** How long a navigation we started may take before URL changes count as the viewer's again. */
export const EXPECTED_NAVIGATION_MS = 20_000
/** An error this soon after sending a video change is the server refusing it. */
const VIDEO_ERROR_WINDOW_MS = 5_000
/** The server allows one video change per 2 s; a refused change is sent again after this. */
export const VIDEO_RETRY_MS = 2_500

/** "Sam switched to a new video", or "You switched…" for this viewer's own change. */
export function videoChangedText(by: PartyMember | null, youId: string | null): string {
  if (by && by.id === youId) return 'You switched to a new video'
  return `${by?.display_name ?? 'Someone'} switched to a new video`
}

interface Room {
  info: StoredParty
  connection: PartyConnection
  status: ConnectionStatus
  memberCount: number
  state: PlaybackState | null
  members: RoomMember[]
  you: PartyMember | null
  chat: ChatLog
  system: SystemLine[]
  /** What this viewer's content script last reported; sent again after a reconnect. */
  localStatus: MemberStatus
  /** We are loading the party's video in the tab: URL changes until it lands are ours. */
  expected: { url: string; from: string | null; until: number } | null
  /** This viewer's video change, until the server confirms it (or after a reconnect). */
  outgoing: { video: PartyVideo; sentAt: number | null } | null
  retryTimer: ReturnType<typeof setTimeout> | null
}

/** The canonical watch URL for a page, or null when it is not a supported player. */
export function watchUrlFor(href: string | null | undefined): string | null {
  if (!href) return null
  return adapterFor(href)?.watchUrl(href) ?? null
}

const toStored = (party: PartyInfo): StoredParty => ({
  code: party.code,
  inviteUrl: party.invite_url,
  hostName: party.host.display_name,
  provider: party.provider,
  watchUrl: party.watch_url,
})

/**
 * The service worker's watch parties, one per tab. Owns each tab's WebSocket and relays
 * room state to that tab's content script; the content script reports local actions back.
 */
export function createPartyRooms(deps: PartyRoomsDeps) {
  const rooms = new Map<number, Room>()
  let restoring: Promise<void> | null = null
  const panelFor = (tabId: number) => deps.panelFor?.(tabId) ?? NO_PANEL
  const now = deps.now ?? Date.now

  function viewOf(room: Room, tabId: number): PartyTabView {
    return {
      ...room.info,
      memberCount: room.memberCount,
      status: room.status,
      state: room.state,
      clockOffsetMs: room.connection.clockOffsetMs(),
      members: room.members,
      youId: room.you?.id ?? null,
      chat: room.chat.messages,
      system: room.system,
      unread: room.chat.unread,
      panelOpen: panelFor(tabId).open,
    }
  }

  /** A live event goes to the tab's content script and to open extension pages. */
  function relay(tabId: number, message: PartyLiveMessage) {
    deps.sendToTab(tabId, message)
    deps.notifyLive?.(tabId, message)
  }

  function relayUnread(tabId: number, room: Room) {
    relay(tabId, {
      type: 'party:unread',
      code: room.info.code,
      unread: room.chat.unread,
      panelOpen: panelFor(tabId).open,
    })
  }

  async function persist() {
    const out: Record<string, StoredParty> = {}
    for (const [tabId, room] of rooms) out[String(tabId)] = room.info
    await deps.save(out)
  }

  function enter(tabId: number, info: StoredParty, memberCount: number): Room {
    // Handlers act only while this room is still the tab's current one, so a late event
    // from a replaced connection never reaches the new party. A status change fired
    // while connect() itself runs (before the room exists) is ignored the same way.
    let room: Room | null = null
    const live = () => (room !== null && rooms.get(tabId) === room ? room : null)
    const relayState = (r: Room, state: PlaybackState) =>
      deps.sendToTab(tabId, {
        type: 'party:state',
        code: info.code,
        state,
        clockOffsetMs: r.connection.clockOffsetMs(),
      })
    const system = (r: Room, id: string, text: string, pill: boolean) => {
      const line: SystemLine = {
        id,
        text,
        at: (now() + r.connection.clockOffsetMs()) / 1000,
      }
      const next = addSystemLine(r.system, line)
      if (next === r.system) return
      r.system = next
      relay(tabId, { type: 'party:system', code: info.code, line, pill })
    }

    /** Points the room (and the tab) at the party's video, loading it if the tab is elsewhere. */
    function follow(r: Room, video: PartyVideo) {
      const watchUrl = watchUrlFor(video.watch_url) ?? video.watch_url
      if (watchUrl !== r.info.watchUrl || video.provider !== r.info.provider) {
        r.info = { ...r.info, watchUrl, provider: video.provider }
        void persist()
      }
      // Before any state for it, so the content script holds states until the video is on the page.
      deps.sendToTab(tabId, { type: 'party:video', code: info.code, watchUrl })
      void (async () => {
        const current = watchUrlFor(await deps.tabUrl(tabId))
        if (live() !== r || current === watchUrl || r.info.watchUrl !== watchUrl) return
        r.expected = { url: watchUrl, from: current, until: now() + EXPECTED_NAVIGATION_MS }
        await deps.navigateTab(tabId, video.watch_url).catch(() => {
          if (r.expected?.url === watchUrl) r.expected = null
        })
      })()
    }

    function sendVideo(r: Room) {
      if (!r.outgoing) return
      r.outgoing.sentAt = r.connection.video(r.outgoing.video) ? now() : null
    }

    function scheduleVideoRetry(r: Room) {
      if (r.retryTimer !== null || !r.outgoing) return
      r.outgoing.sentAt = null
      r.retryTimer = setTimeout(() => {
        r.retryTimer = null
        if (live() === r && r.outgoing) sendVideo(r)
      }, VIDEO_RETRY_MS)
    }

    const handlers: ConnectionHandlers = {
      onWelcome(state, members, you, extras) {
        const r = live()
        if (!r) return
        r.state = state
        r.memberCount = members
        r.status = 'live'
        r.you = you
        if (extras) {
          r.members = extras.members
          r.chat = mergeChatHistory(r.chat, extras.chat)
        }
        // The room starts every (re)joined member as watching.
        if (r.localStatus !== 'watching') r.connection.status(r.localStatus)
        if (r.outgoing && r.outgoing.video.watch_url !== extras?.video?.watch_url) {
          // This viewer changed the video while disconnected: that change goes up now.
          sendVideo(r)
        } else if (extras?.video) {
          r.outgoing = null
          follow(r, extras.video)
        }
        relayState(r, state)
        deps.sendToTab(tabId, { type: 'party:members', code: info.code, count: members })
        relay(tabId, { type: 'party:presence', code: info.code, members: r.members })
        deps.notifyChanged(tabId)
      },
      onPresence(members) {
        const r = live()
        if (!r) return
        r.members = members
        relay(tabId, { type: 'party:presence', code: info.code, members })
        if (members.length > 0 && members.length !== r.memberCount) {
          r.memberCount = members.length
          deps.sendToTab(tabId, { type: 'party:members', code: info.code, count: members.length })
        }
      },
      onChat(message) {
        const r = live()
        if (!r) return
        const panel = panelFor(tabId)
        const { log, added } = addChatMessage(r.chat, message, {
          selfId: r.you?.id ?? null,
          reading: panel.reading,
        })
        if (!added) return
        r.chat = log
        relay(tabId, {
          type: 'party:chat',
          code: info.code,
          message,
          unread: log.unread,
          panelOpen: panel.open,
        })
      },
      onReaction(reaction) {
        if (!live()) return
        relay(tabId, { type: 'party:reaction', code: info.code, reaction })
      },
      onVideo(video, by, seq) {
        const r = live()
        if (!r) return
        // Whoever's change the server took last wins; a pending change of ours is dropped.
        r.outgoing = null
        if (r.retryTimer !== null) clearTimeout(r.retryTimer)
        r.retryTimer = null
        follow(r, video)
        const own = by !== null && by.id === r.you?.id
        system(r, `video-${seq}`, videoChangedText(by, r.you?.id ?? null), !own)
        deps.notifyChanged(tabId)
      },
      onError(detail) {
        const r = live()
        if (!r) return
        const sentAt = r.outgoing?.sentAt
        if (sentAt != null && now() - sentAt < VIDEO_ERROR_WINDOW_MS) {
          // The server refused this viewer's video change (most likely too soon after
          // another). Say so, and send it again once the limit allows.
          system(r, `video-error-${sentAt}`, detail, true)
          scheduleVideoRetry(r)
          return
        }
        relay(tabId, { type: 'party:error', code: info.code, detail })
      },
      onState(state) {
        const r = live()
        if (!r) return
        r.state = state
        relayState(r, state)
      },
      onMembers(count) {
        const r = live()
        if (!r) return
        r.memberCount = count
        deps.sendToTab(tabId, { type: 'party:members', code: info.code, count })
        deps.notifyChanged(tabId)
      },
      onStatus(status) {
        const r = live()
        if (!r) return
        r.status = status
        deps.notifyChanged(tabId)
      },
      onEnd(reason) {
        const r = live()
        if (!r) return
        if (r.retryTimer !== null) clearTimeout(r.retryTimer)
        rooms.delete(tabId)
        void persist()
        deps.sendToTab(tabId, {
          type: 'party:ended',
          code: info.code,
          reason: reason === 'ended' ? 'ended' : 'error',
        })
        deps.notifyChanged(tabId)
      },
    }

    const connection = deps.connect(info.code, handlers)
    const created: Room = {
      info,
      connection,
      memberCount,
      status: 'connecting',
      state: null,
      members: [],
      you: null,
      chat: emptyChatLog(),
      system: [],
      localStatus: 'watching',
      expected: null,
      outgoing: null,
      retryTimer: null,
    }
    room = created
    rooms.set(tabId, created)
    void persist()
    deps.notifyChanged(tabId)
    return created
  }

  async function leave(tabId: number, tell: boolean): Promise<void> {
    const room = rooms.get(tabId)
    if (!room) return
    rooms.delete(tabId)
    room.connection.close()
    if (room.retryTimer !== null) clearTimeout(room.retryTimer)
    await persist()
    if (tell) deps.sendToTab(tabId, { type: 'party:ended', code: room.info.code, reason: 'left' })
    deps.notifyChanged(tabId)
    // Best effort: the server also drops members whose socket goes away.
    await deps.api.leave(room.info.code).catch(() => undefined)
  }

  /** Reconnects parties that were live before the service worker restarted. */
  function restored(): Promise<void> {
    restoring ??= (async () => {
      const stored = await deps.load().catch(() => ({}) as Record<string, StoredParty>)
      for (const [key, info] of Object.entries(stored)) {
        const tabId = Number(key)
        if (!Number.isInteger(tabId) || rooms.has(tabId)) continue
        const url = await deps.tabUrl(tabId)
        if (watchUrlFor(url) === info.watchUrl) enter(tabId, info, 0)
      }
      await persist()
    })()
    return restoring
  }

  return {
    restore: restored,

    async start(tabId: number): Promise<Result<PartyTabView>> {
      await restored()
      const url = await deps.tabUrl(tabId)
      const adapter = url ? adapterFor(url) : undefined
      const watchUrl = url && adapter ? adapter.watchUrl(url) : null
      if (!adapter || !watchUrl) return fail('rejected')
      const created = await deps.api.create({
        provider: adapter.id,
        watch_url: watchUrl,
        episode_id: await deps.episodeIdForTab(tabId),
      })
      if (!created.ok) return created
      await leave(tabId, false)
      return ok(viewOf(enter(tabId, toStored(created.data), created.data.member_count), tabId))
    },

    /**
     * From an invite link on the tab. Without `confirm` it only looks the party up so the
     * content script can ask the viewer; with it, it joins and connects.
     */
    async joinRequest(
      tabId: number,
      tabUrl: string,
      code: string,
      confirm: boolean,
    ): Promise<Result<PartyTabView>> {
      await restored()
      const existing = rooms.get(tabId)
      if (existing?.info.code === code) return ok(viewOf(existing, tabId))
      const watchUrl = watchUrlFor(tabUrl)
      const found = confirm ? await deps.api.join(code) : await deps.api.get(code)
      if (!found.ok) return found
      // The link must open the video the party is watching now. The server's watch_url
      // follows video changes, so a link opened after the party moved on still joins.
      const partyVideo = watchUrlFor(found.data.watch_url) ?? found.data.watch_url
      if (!watchUrl || partyVideo !== watchUrl) return fail('rejected')
      const info = toStored(found.data)
      if (!confirm) {
        return ok({
          ...info,
          memberCount: found.data.member_count,
          status: 'invited',
          state: null,
          clockOffsetMs: 0,
          members: [],
          youId: null,
          chat: [],
          system: [],
          unread: 0,
          panelOpen: false,
        })
      }
      await leave(tabId, false)
      return ok(viewOf(enter(tabId, info, found.data.member_count), tabId))
    },

    async leave(tabId: number): Promise<void> {
      await restored()
      await leave(tabId, true)
    },

    async leaveAll(): Promise<void> {
      await restored()
      await Promise.all([...rooms.keys()].map((tabId) => leave(tabId, true)))
    },

    async viewFor(tabId: number): Promise<PartyTabView | null> {
      await restored()
      const room = rooms.get(tabId)
      return room ? viewOf(room, tabId) : null
    },

    async report(tabId: number, action: LocalAction): Promise<boolean> {
      await restored()
      const room = rooms.get(tabId)
      if (!room) return false
      return room.connection.control(action.action, action.position, action.rate)
    },

    /** Sends a chat message to the tab's room. False when not connected. */
    async sendChat(tabId: number, text: string): Promise<boolean> {
      await restored()
      return rooms.get(tabId)?.connection.chat(text) ?? false
    },

    async react(tabId: number, kind: ReactionKind): Promise<boolean> {
      await restored()
      return rooms.get(tabId)?.connection.react(kind) ?? false
    },

    /** The content script's status for this viewer. Kept to resend after a reconnect. */
    async setStatus(tabId: number, status: MemberStatus): Promise<boolean> {
      await restored()
      const room = rooms.get(tabId)
      if (!room) return false
      room.localStatus = status
      return room.connection.status(status)
    },

    /** The Party tab is on screen for this tab: its chat counts as read. */
    async markRead(tabId: number): Promise<void> {
      await restored()
      const room = rooms.get(tabId)
      if (!room || room.chat.unread === 0) return
      room.chat = markChatRead(room.chat)
      relayUnread(tabId, room)
    },

    /** A side panel opened, closed, or switched tab or view: update the pill's unread dot. */
    async panelChanged(tabId: number): Promise<void> {
      await restored()
      const room = rooms.get(tabId)
      if (!room) return
      if (panelFor(tabId).reading) room.chat = markChatRead(room.chat)
      relayUnread(tabId, room)
    },

    /**
     * The tab navigated. Another video on the same player moves the whole party there;
     * leaving the player (another site, or a page without a video) leaves the party.
     */
    async tabUrlChanged(tabId: number, url: string): Promise<void> {
      await restored()
      const room = rooms.get(tabId)
      if (!room) return
      const adapter = adapterFor(url)
      const next = adapter?.watchUrl(url) ?? null
      if (!adapter || !next) {
        await leave(tabId, true)
        return
      }
      if (next === room.info.watchUrl) {
        // Same video (a timestamp, the invite fragment being stripped), or our own
        // navigation to the party's video has landed.
        if (room.expected?.url === next) room.expected = null
        return
      }
      if (room.expected && now() < room.expected.until && next === room.expected.from) {
        // We are loading the party's video; this is the tab still on the old one.
        return
      }
      room.expected = null
      // The viewer picked another video: the party follows. Updated before any await so
      // the next URL event for the same video is a no-op.
      room.info = { ...room.info, watchUrl: next, provider: adapter.id }
      const video: PartyVideo = { watch_url: next, provider: adapter.id, episode_id: null }
      room.outgoing = { video, sentAt: null }
      if (room.retryTimer !== null) clearTimeout(room.retryTimer)
      room.retryTimer = null
      void persist()
      deps.sendToTab(tabId, { type: 'party:video', code: room.info.code, watchUrl: next })
      deps.notifyChanged(tabId)
      video.episode_id = (await deps.episodeIdForUrl?.(adapter.id, next).catch(() => null)) ?? null
      if (rooms.get(tabId) !== room || room.outgoing?.video !== video) return
      room.outgoing.sentAt = room.connection.video(video) ? now() : null
    },

    async tabClosed(tabId: number): Promise<void> {
      await restored()
      await leave(tabId, false)
    },
  }
}

export type PartyRooms = ReturnType<typeof createPartyRooms>
