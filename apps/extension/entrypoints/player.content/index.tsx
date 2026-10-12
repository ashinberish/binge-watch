import '@nightreel/ui/styles.css'
import './style.css'

import { NEXT_EPISODE_COUNTDOWN_SECONDS } from '@nightreel/shared'
import { createRoot, type Root } from 'react-dom/client'

import { SUPPORTED_HOSTS } from '../../src/adapters/hosts'
import { adapterFor, adapterForSite } from '../../src/adapters/registry'
import { createCountdownController } from '../../src/features/countdown/controller'
import { NextEpisodeCard } from '../../src/features/countdown/NextEpisodeCard'
import { send } from '../../src/messaging/protocol'

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
        ui.mounted?.render(
          view ? (
            <NextEpisodeCard
              key={view.key}
              next={view.next}
              seconds={view.seconds}
              paused={view.paused}
              onPlay={controller.playNext}
              onDismiss={controller.dismiss}
            />
          ) : null,
        )
      },
    })

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

    ctx.setInterval(controller.tick, TICK_MS)

    // Media events don't bubble; capture catches them from whichever <video> the player uses.
    const onEnded = () => {
      report()
      controller.tick()
    }
    ctx.addEventListener(document, 'ended', onEnded, { capture: true })
    ctx.addEventListener(document, 'pause', report, { capture: true })
  },
})
