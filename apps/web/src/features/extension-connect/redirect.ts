/**
 * chrome.identity redirect URLs look like https://<32 letters a–p>.chromiumapp.org/...
 * Anything else is refused: the code must only ever go back to a Chrome extension.
 */
export const EXTENSION_REDIRECT_PATTERN = /^https:\/\/[a-p]{32}\.chromiumapp\.org\/[^#\s]*$/

export function isExtensionRedirect(value: unknown): value is string {
  if (typeof value !== 'string' || !EXTENSION_REDIRECT_PATTERN.test(value)) return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      /^[a-p]{32}\.chromiumapp\.org$/.test(url.hostname) &&
      url.port === '' &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

/** The URL the browser goes to once the code exists. The code rides in the fragment. */
export function extensionCallbackUrl(redirectUri: string, code: string): string {
  return `${redirectUri}#code=${encodeURIComponent(code)}`
}
