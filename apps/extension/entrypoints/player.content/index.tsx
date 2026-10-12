import '@nightreel/ui/styles.css'
import './style.css'

import { NEXT_EPISODE_COUNTDOWN_SECONDS } from '@nightreel/shared'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { SUPPORTED_HOSTS } from '../../src/adapters/hosts'
import { adapterFor, adapterForSite } from '../../src/adapters/registry'
import { createCountdownController } from '../../src/features/countdown/controller'
import { NextEpisodeCard } from '../../src/features/countdown/NextEpisodeCard'
import { createPartyOverlay } from '../../src/features/party/overlay'
import { PartyOverlay } from '../../src/features/party/PartyOverlay'
import { MEDIA_EVENTS } from '../../src/party/engine'
import { isPartyTabMessage, send } from '../../src/messaging/protocol'

const REPORT_EVERY_MS = 15_000
const TICK_MS = 1_000

export default defineContentScript({
  matches: [...SUPPORTED_HOSTS],
  cssInjectionMode: 'ui',
  async main(ctx) {
    // Sites like YouTube navigate without reloading, so this runs on every page of the
    // site and checks for a player page on each tick.
    const site = adapterForSite(location.href)
    if (!site) return

    let countdownSeconds = NEXT_EPISODE_COUNTDOWN_SECONDS

    // Overlay UI lives in a shadow root so the site's CSS can't leak in or out.
    const ui = await createShadowRootUi<Root>(ctx, {
      name: 'nightreel-overlay',
      position: 'overlay',
      anchor: 'body',
      onMount: (container) => createRoot(container),
      onRemove: (root) => root?.unmount(),
    })
    ui.mount()

    // The countdown card and the watch party share the shadow root.
    let countdownNode: ReactNode = null
    let partyNode: ReactNode = null
    const renderOverlay = () =>
      ui.mounted?.render(
        <>
          {partyNode}
          {countdownNode}
        </>,
      )

    const controller = createCountdownController({
      adapter: site,
      doc: document,
      countdownSeconds: () => countdownSeconds,
      async lookup(adapter, video) {
        const snapshot = adapter.snapshot(document, video)
        if (!snapshot) return null
        try {
          const [settings, match] = await Promise.all([
            send({ type: 'settings:get' }),
            send({ type: 'episode:current', adapter: adapter.id, snapshot }),
          ])
          countdownSeconds = settings.countdownSeconds
          return match.ok ? match.data : null
        } catch {
          return null // extension reloaded or service worker unavailable
        }
      },
      render(view) {
        countdownNode = view ? (
          <NextEpisodeCard
            key={view.key}
            next={view.next}
            seconds={view.seconds}
            paused={view.paused}
            onPlay={controller.playNext}
            onDismiss={controller.dismiss}
          />
        ) : null
        renderOverlay()
      },
    })

    const party = createPartyOverlay({
      adapter: site,
      doc: document,
      send,
      replaceUrl: (url) => history.replaceState(history.state, '', url),
      render(view) {
        partyNode = view ? (
          <PartyOverlay
            view={view}
            onJoin={() => void party.join()}
            onDismiss={party.dismiss}
            onResync={party.resync}
            onOpenPanel={() => void party.openPanel()}
            onToggleReactions={party.toggleReactions}
            onCloseReactions={party.closeReactions}
            onReact={party.react}
          />
        ) : null
        renderOverlay()
      },
    })
    const onPartyMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.id === chrome.runtime.id && isPartyTabMessage(message)) party.receive(message)
    }
    chrome.runtime.onMessage.addListener(onPartyMessage)
    ctx.onInvalidated(() => chrome.runtime.onMessage.removeListener(onPartyMessage))
    // In-page navigation: an invite link, or another video (the party follows it; tick
    // starts the sync engine afresh once the party's video is on the page).
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      party.checkInvite()
      party.tick()
    })
    ctx.addEventListener(document, 'visibilitychange', () => party.visibilityChanged())
    for (const type of MEDIA_EVENTS) {
      ctx.addEventListener(document, type, (event) => party.mediaEvent(type, event.target), {
        capture: true,
      })
    }
    void party.start()

    const report = () => {
      const video = site.findVideo(document)
      if (!adapterFor(location.href) || !video || site.isAd?.(document)) return
      const snapshot = site.snapshot(document, video)
      if (snapshot) {
        send({ type: 'progress', adapter: site.id, snapshot }).catch(() => undefined)
      }
    }

    ctx.setInterval(() => {
      if (!site.findVideo(document)?.paused) report()
    }, REPORT_EVERY_MS)

    ctx.setInterval(() => {
      controller.tick()
      party.tick()
    }, TICK_MS)

    // Media events don't bubble; capture catches them from whichever <video> the player uses.
    const onEnded = () => {
      report()
      controller.tick()
    }
    ctx.addEventListener(document, 'ended', onEnded, { capture: true })
    ctx.addEventListener(document, 'pause', report, { capture: true })
  },
})
