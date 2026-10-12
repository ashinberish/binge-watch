import type { PlayerAdapter } from '../types'

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/

function pageUrl(page: Document | URL | string): URL | null {
  try {
    if (typeof page === 'string') return new URL(page)
    if (page instanceof URL) return page
    return new URL(page.location.href)
  } catch {
    return null
  }
}

export const youtube: PlayerAdapter = {
  id: 'youtube',
  name: 'YouTube',
  site: 'youtube.com',
  matches: (url) => url.hostname === 'www.youtube.com' && url.pathname === '/watch',
  findVideo: (doc) => doc.querySelector<HTMLVideoElement>('video.html5-main-video'),
  snapshot(doc, video) {
    const id = new URL(doc.location.href).searchParams.get('v')
    if (!id || !Number.isFinite(video.duration)) return null
    return {
      externalId: id,
      showTitle: doc.title.replace(/ - YouTube$/, ''),
      episodeTitle: null,
      season: null,
      episode: null,
      positionSeconds: Math.floor(video.currentTime),
      durationSeconds: Math.floor(video.duration),
    }
  },
  watchUrl(page) {
    const url = pageUrl(page)
    if (!url || url.hostname !== 'www.youtube.com' || url.pathname !== '/watch') return null
    const id = url.searchParams.get('v')
    return id && VIDEO_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null
  },
  externalId(watchUrl) {
    const canonical = youtube.watchUrl(watchUrl)
    return canonical ? new URL(canonical).searchParams.get('v') : null
  },
  playNext(doc) {
    const next = doc.querySelector<HTMLElement>('.ytp-next-button')
    if (!next || next.getAttribute('aria-disabled') === 'true') return false
    next.click()
    return true
  },
  isAd: (doc) => doc.querySelector('.html5-video-player.ad-showing') !== null,
}
