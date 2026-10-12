/** The fragment the Nightreel extension looks for on the watch page. */
export const PARTY_FRAGMENT_KEY = 'nightreel-party'

/**
 * The URL that opens the party's video with the invite for the extension:
 * `${watch_url}#nightreel-party=${code}`. The watch URL comes from our API, but it is
 * still checked here: only https, never another scheme (javascript:, data:, http:).
 */
export function partyWatchLink(watchUrl: string, code: string): string | null {
  let url: URL
  try {
    url = new URL(watchUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null
  url.hash = `${PARTY_FRAGMENT_KEY}=${encodeURIComponent(code)}`
  return url.toString()
}

const PROVIDER_NAMES: Record<string, string> = { youtube: 'YouTube' }

/** "YouTube" for "youtube"; unknown providers are shown as sent. */
export function providerName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider
}
