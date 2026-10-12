import '@nightreel/ui/styles.css'
import './style.css'

import { createRoot, type Root } from 'react-dom/client'

import { adapterFor } from '../../src/adapters/registry'
import { SUPPORTED_HOSTS } from '../../src/adapters/hosts'
import { send } from '../../src/messaging/protocol'

const REPORT_EVERY_MS = 15_000

export default defineContentScript({
  matches: [...SUPPORTED_HOSTS],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const adapter = adapterFor(location.href)
    if (!adapter) return

    // Overlay UI lives in a shadow root so the site's CSS can't leak in or out.
    const ui = await createShadowRootUi<Root>(ctx, {
      name: 'nightreel-overlay',
      position: 'overlay',
      anchor: 'body',
      onMount(container) {
        const root = createRoot(container)
        root.render(null) // NextEpisodeCard mounts here once episode matching lands
        return root
      },
      onRemove: (root) => root?.unmount(),
    })
    ui.mount()

    ctx.setInterval(() => {
      const video = adapter.findVideo(document)
      if (!video || video.paused) return
      const snapshot = adapter.snapshot(document, video)
      if (snapshot) void send({ type: 'progress', adapter: adapter.id, snapshot })
    }, REPORT_EVERY_MS)
  },
})
