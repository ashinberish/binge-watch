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
  /** Provider id sent to the API, e.g. "youtube". */
  id: string
  /** Display name for settings, e.g. "YouTube". */
  name: string
  /** Display domain for settings, e.g. "youtube.com". */
  site: string
  matches(url: URL): boolean
  /** The page's main <video>, once the player has mounted. */
  findVideo(doc: Document): HTMLVideoElement | null
  snapshot(doc: Document, video: HTMLVideoElement): PlaybackSnapshot | null
  /**
   * The canonical https URL of what this page plays, without timestamps or tracking
   * parameters, e.g. https://www.youtube.com/watch?v=<id>. A watch party is keyed on it,
   * so every viewer's tab must produce the same string. Null when the page has no video.
   */
  watchUrl(page: Document | URL | string): string | null
  /** Starts the next episode with the player's own control. Returns false if it could not. */
  playNext?(doc: Document): boolean
  /** True while the player is showing an ad. The countdown never covers ads. */
  isAd?(doc: Document): boolean
}
