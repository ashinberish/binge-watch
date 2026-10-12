export interface PlaybackSnapshot {
  /** Stable id of the episode on the streaming service. */
  externalId: string
  showTitle: string
  episodeTitle: string | null
  season: number | null
  episode: number | null
  positionSeconds: number
  durationSeconds: number
}

/**
 * One adapter per streaming service. Supporting a new player means adding one
 * file in ./sites and registering it — nothing else changes.
 */
export interface PlayerAdapter {
  id: string
  matches(url: URL): boolean
  /** The page's main <video>, once the player has mounted. */
  findVideo(doc: Document): HTMLVideoElement | null
  snapshot(doc: Document, video: HTMLVideoElement): PlaybackSnapshot | null
}
