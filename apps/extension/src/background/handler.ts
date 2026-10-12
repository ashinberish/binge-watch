import type { PlaybackSnapshot } from '../adapters/types'
import { adapterFor } from '../adapters/registry'
import { fail } from '../lib/result'
import type { AnyReply, Message, ReplyOf, Settings } from '../messaging/protocol'

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
}

export type Sender = Pick<chrome.runtime.MessageSender, 'tab' | 'url'>

/** Messages a content script on a supported player may send. Everything else is extension pages only. */
const FROM_CONTENT = new Set<Message['type']>(['progress', 'episode:current', 'settings:get'])

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
      default:
        return undefined
    }
  }
}
