import type { PlayerAdapter } from '../types'

export const youtube: PlayerAdapter = {
  id: 'youtube',
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
}
