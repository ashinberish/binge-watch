/** chrome.identity.getRedirectURL() is always https://<extension id>.chromiumapp.org/... */
export const EXTENSION_REDIRECT = /^https:\/\/[a-p]{32}\.chromiumapp\.org\//

/** The web app page that asks the signed-in viewer to connect the extension. */
export function connectUrl(webUrl: string, redirectUri: string): string {
  return `${webUrl}/extension/connect?redirect_uri=${encodeURIComponent(redirectUri)}`
}

const MAX_CODE_LENGTH = 512

/**
 * Pulls the one-time code out of the URL the auth flow finished on
 * (`<redirectUri>#code=...`). Returns null for anything else, including a URL that is
 * not our own redirect.
 */
export function parseCodeFromRedirect(
  responseUrl: string | undefined,
  redirectUri: string,
): string | null {
  if (!responseUrl || !EXTENSION_REDIRECT.test(redirectUri)) return null
  let url: URL
  let expected: URL
  try {
    url = new URL(responseUrl)
    expected = new URL(redirectUri)
  } catch {
    return null
  }
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) return null
  const code = new URLSearchParams(url.hash.replace(/^#/, '')).get('code')
  if (!code || code.length > MAX_CODE_LENGTH || /\s/.test(code)) return null
  return code
}
