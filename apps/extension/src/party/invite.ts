/**
 * Invite links from the web app open the watch page with `#nightreel-party=<code>`.
 * The content script reads the code, then strips it so a reload or a shared URL does
 * not ask again.
 */
export const PARTY_FRAGMENT_KEY = 'nightreel-party'

const CODE_PATTERN = /^[A-Za-z0-9_-]{4,64}$/

function fragmentParams(url: URL): URLSearchParams {
  return new URLSearchParams(url.hash.replace(/^#/, ''))
}

/** The party code in a URL's fragment, or null when there is none or it looks wrong. */
export function parsePartyFragment(href: string): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const code = fragmentParams(url).get(PARTY_FRAGMENT_KEY)
  return code && CODE_PATTERN.test(code) ? code : null
}

/** The same URL without the party code. Other fragment parameters are kept. */
export function stripPartyFragment(href: string): string {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return href
  }
  const params = fragmentParams(url)
  if (!params.has(PARTY_FRAGMENT_KEY)) return href
  params.delete(PARTY_FRAGMENT_KEY)
  const rest = params.toString()
  url.hash = rest ? `#${rest}` : ''
  // An empty hash still leaves a trailing "#" on some engines.
  return url.toString().replace(/#$/, '')
}
