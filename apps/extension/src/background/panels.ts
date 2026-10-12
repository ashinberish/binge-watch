import type { PanelView } from '../party/rooms'

/** The long-lived port each open side panel keeps to the service worker. */
export const PANEL_PORT = 'nightreel:panel'

/** Side panel → service worker over the port: which tab it shows and which view. */
export interface PanelReport {
  type: 'panel:view'
  tabId: number | null
  /** The Party tab is selected and the panel is visible. */
  reading: boolean
}

export function isPanelReport(value: unknown): value is PanelReport {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.type === 'panel:view' &&
    (v.tabId === null || (typeof v.tabId === 'number' && Number.isInteger(v.tabId))) &&
    typeof v.reading === 'boolean'
  )
}

/**
 * Which tabs open side panels are showing (one panel per window, so possibly several).
 * Keyed by the panel's port; `update` and `remove` return the tabs whose view changed.
 */
export function createPanelTracker<K>() {
  const panels = new Map<K, { tabId: number | null; reading: boolean }>()

  return {
    update(key: K, report: PanelReport): number[] {
      const before = panels.get(key)
      panels.set(key, { tabId: report.tabId, reading: report.reading })
      const touched = new Set<number>()
      if (before?.tabId != null) touched.add(before.tabId)
      if (report.tabId !== null) touched.add(report.tabId)
      return [...touched]
    },

    remove(key: K): number[] {
      const before = panels.get(key)
      panels.delete(key)
      return before?.tabId != null ? [before.tabId] : []
    },

    viewFor(tabId: number): PanelView {
      let open = false
      let reading = false
      for (const panel of panels.values()) {
        if (panel.tabId !== tabId) continue
        open = true
        reading ||= panel.reading
      }
      return { open, reading }
    },
  }
}

export type PanelTracker<K> = ReturnType<typeof createPanelTracker<K>>
