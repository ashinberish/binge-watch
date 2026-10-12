import type { PlaybackSnapshot } from '../adapters/types'
import { adapterFor } from '../adapters/registry'
import { fail } from '../lib/result'
import type { AnyReply, Message, ReplyOf, Settings } from '../messaging/protocol'
import { cleanChatText } from '../party/chat'
import type { LocalAction } from '../party/engine'
import {
  isControlAction,
  isMemberStatus,
  isReactionKind,
  type MemberStatus,
  type ReactionKind,
} from '../party/protocol'

/** Everything the service worker can do, one method per message. */
export interface Services {
  pushProgress(adapter: string, snapshot: PlaybackSnapshot): Promise<void>
  currentEpisode(
    tabId: number,
    adapter: string,
    snapshot: PlaybackSnapshot,
  ): Promise<ReplyOf<'episode:current'>>
  sessionState(): Promise<ReplyOf<'session:get'>>
  signIn(): Promise<ReplyOf<'session:sign-in'>>
  signOut(): Promise<void>
  listProfiles(): Promise<ReplyOf<'profiles:list'>>
  setProfile(profileId: string): Promise<boolean>
  continueWatching(): Promise<ReplyOf<'history:continue'>>
  streak(): Promise<ReplyOf<'streak:get'>>
  episodeForTab(tabId: number): Promise<ReplyOf<'episode:for-tab'>>
  show(showId: string): Promise<ReplyOf<'show:get'>>
  getSettings(): Promise<Settings>
  setSettings(settings: Partial<Settings>): Promise<Settings>
  startParty(tabId: number): Promise<ReplyOf<'party:start'>>
  leaveParty(tabId: number): Promise<void>
  partyForTab(tabId: number): Promise<ReplyOf<'party:get-for-tab'>>
  partyJoinRequest(
    tabId: number,
    tabUrl: string,
    code: string,
    confirm: boolean,
  ): Promise<ReplyOf<'party:join-request'>>
  reportPartyAction(tabId: number, action: LocalAction): Promise<boolean>
  setPartyStatus(tabId: number, status: MemberStatus): Promise<boolean>
  reactInParty(tabId: number, kind: ReactionKind): Promise<boolean>
  sendPartyChat(tabId: number, text: string): Promise<boolean>
  markPartyRead(tabId: number): Promise<void>
  /**
   * Opens the side panel on the tab. Must call chrome.sidePanel.open before its first
   * await: Chrome only allows it while the click's user gesture is still current.
   */
  openPanel(tabId: number): Promise<boolean>
}

export type Sender = Pick<chrome.runtime.MessageSender, 'tab' | 'url'>

/** Messages a content script on a supported player may send. Everything else is extension pages only. */
const FROM_CONTENT = new Set<Message['type']>([
  'progress',
  'episode:current',
  'settings:get',
  'party:report',
  'party:join-request',
  'party:get-for-tab',
  'party:status',
  'party:react',
  'party:open-panel',
])

const PARTY_CODE = /^[A-Za-z0-9_-]{4,64}$/
/** Browsers clamp playbackRate to roughly this range. */
const MAX_RATE = 16

function isMessage(value: unknown): value is Message {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

function isSnapshot(value: unknown): value is PlaybackSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  return (
    typeof s.externalId === 'string' &&
    s.externalId.length > 0 &&
    typeof s.showTitle === 'string' &&
    typeof s.positionSeconds === 'number' &&
    typeof s.durationSeconds === 'number'
  )
}

/** A reported play/pause/seek, checked field by field (the content script is not trusted). */
function isValidAction(action: unknown, position: unknown, rate: unknown): boolean {
  return (
    isControlAction(action) &&
    typeof position === 'number' &&
    Number.isFinite(position) &&
    position >= 0 &&
    (rate === undefined ||
      (typeof rate === 'number' && Number.isFinite(rate) && rate > 0 && rate <= MAX_RATE))
  )
}

/**
 * Routes a runtime message to a service after checking who sent it. Extension pages
 * are recognised by their chrome-extension:// origin; content scripts by a tab on a
 * player we have an adapter for, and only for the adapter that matches that tab.
 */
export function createHandler(services: Services, extensionOrigin: string) {
  const fromExtensionPage = (sender: Sender) =>
    typeof sender.url === 'string' && sender.url.startsWith(extensionOrigin)

  const playerTab = (sender: Sender, adapter: string) => {
    const url = sender.tab?.url
    const id = sender.tab?.id
    if (!url || id === undefined || adapterFor(url)?.id !== adapter) return null
    return id
  }

  /** The tab a party message is about: any tab for extension pages, else the sender's own player tab. */
  const partyTab = (sender: Sender, tabId: unknown) => {
    if (fromExtensionPage(sender)) return typeof tabId === 'number' ? tabId : null
    const url = sender.tab?.url
    const id = sender.tab?.id
    return url && id !== undefined && adapterFor(url) ? id : null
  }

  return async function handle(message: unknown, sender: Sender): Promise<AnyReply | undefined> {
    if (!isMessage(message)) return undefined
    if (!FROM_CONTENT.has(message.type) && !fromExtensionPage(sender)) return { ok: false }

    switch (message.type) {
      case 'progress': {
        if (playerTab(sender, message.adapter) === null || !isSnapshot(message.snapshot)) {
          return { ok: false }
        }
        await services.pushProgress(message.adapter, message.snapshot)
        return { ok: true }
      }
      case 'episode:current': {
        const tabId = playerTab(sender, message.adapter)
        if (tabId === null || !isSnapshot(message.snapshot)) return fail('rejected')
        return services.currentEpisode(tabId, message.adapter, message.snapshot)
      }
      case 'settings:get':
        return services.getSettings()
      case 'session:get':
        return services.sessionState()
      case 'session:sign-in':
        return services.signIn()
      case 'session:sign-out':
        await services.signOut()
        return { ok: true }
      case 'profiles:list':
        return services.listProfiles()
      case 'profile:set':
        if (typeof message.profileId !== 'string' || !message.profileId) return { ok: false }
        return { ok: await services.setProfile(message.profileId) }
      case 'history:continue':
        return services.continueWatching()
      case 'streak:get':
        return services.streak()
      case 'episode:for-tab':
        if (typeof message.tabId !== 'number') return null
        return services.episodeForTab(message.tabId)
      case 'show:get':
        if (typeof message.showId !== 'string' || !message.showId) return fail('rejected')
        return services.show(message.showId)
      case 'settings:set':
        return services.setSettings(message.settings ?? {})
      case 'party:report': {
        const tabId = playerTab(sender, message.adapter)
        if (tabId === null || !isValidAction(message.action, message.position, message.rate)) {
          return { ok: false }
        }
        return {
          ok: await services.reportPartyAction(tabId, {
            action: message.action,
            position: message.position,
            rate: message.rate ?? 1,
          }),
        }
      }
      case 'party:join-request': {
        const tabId = playerTab(sender, message.adapter)
        const tabUrl = sender.tab?.url
        if (tabId === null || !tabUrl) return fail('rejected')
        if (typeof message.code !== 'string' || !PARTY_CODE.test(message.code)) {
          return fail('rejected')
        }
        return services.partyJoinRequest(tabId, tabUrl, message.code, message.confirm === true)
      }
      case 'party:get-for-tab': {
        const tabId = partyTab(sender, message.tabId)
        return tabId === null ? null : services.partyForTab(tabId)
      }
      case 'party:status': {
        const tabId = playerTab(sender, message.adapter)
        if (tabId === null || !isMemberStatus(message.status)) return { ok: false }
        return { ok: await services.setPartyStatus(tabId, message.status) }
      }
      case 'party:react': {
        const tabId = partyTab(sender, message.tabId)
        if (tabId === null || !isReactionKind(message.kind)) return { ok: false }
        return { ok: await services.reactInParty(tabId, message.kind) }
      }
      case 'party:open-panel': {
        // Only the pill on a player page asks for this, for its own tab.
        const url = sender.tab?.url
        const tabId = sender.tab?.id
        if (fromExtensionPage(sender) || !url || tabId === undefined || !adapterFor(url)) {
          return { ok: false }
        }
        return { ok: await services.openPanel(tabId) }
      }
      case 'party:send-chat': {
        const text = cleanChatText(message.text)
        if (typeof message.tabId !== 'number' || text === null) return { ok: false }
        return { ok: await services.sendPartyChat(message.tabId, text) }
      }
      case 'party:mark-read':
        if (typeof message.tabId !== 'number') return { ok: false }
        await services.markPartyRead(message.tabId)
        return { ok: true }
      case 'party:start':
        if (typeof message.tabId !== 'number') return fail('rejected')
        return services.startParty(message.tabId)
      case 'party:leave':
        if (typeof message.tabId !== 'number') return { ok: false }
        await services.leaveParty(message.tabId)
        return { ok: true }
      default:
        return undefined
    }
  }
}
