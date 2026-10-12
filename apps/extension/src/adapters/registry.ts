import { youtube } from './sites/youtube'
import type { PlayerAdapter } from './types'

export const adapters: readonly PlayerAdapter[] = [youtube]

export function adapterFor(href: string): PlayerAdapter | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }
  return adapters.find((adapter) => adapter.matches(url))
}

/** The adapter for a site, on any of its pages (the content script starts before the viewer reaches a player). */
export function adapterForSite(href: string): PlayerAdapter | undefined {
  let host: string
  try {
    host = new URL(href).hostname
  } catch {
    return undefined
  }
  return adapters.find((adapter) => host === adapter.site || host.endsWith(`.${adapter.site}`))
}
