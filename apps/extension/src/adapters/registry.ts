import { youtube } from './sites/youtube'
import type { PlayerAdapter } from './types'

const adapters: PlayerAdapter[] = [youtube]

export function adapterFor(href: string): PlayerAdapter | undefined {
  const url = new URL(href)
  return adapters.find((adapter) => adapter.matches(url))
}
