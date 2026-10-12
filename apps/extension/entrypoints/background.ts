import { createHandler } from '../src/background/handler'
import { isPanelReport, PANEL_PORT } from '../src/background/panels'
import { forgetTab, panels, rooms, scheduler, services } from '../src/background/services'
import { session } from '../src/lib/api'

const SYNC_ALARM = 'nightreel:sync'

export default defineBackground(() => {
  const handle = createHandler(services, chrome.runtime.getURL(''))

  // There is no popup: the toolbar button opens the side panel, which holds the whole UI.
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined)

  void chrome.alarms.get(SYNC_ALARM).then((alarm) => {
    if (!alarm) void chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 })
  })
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void session.load().then(scheduler.now)
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    void forgetTab(tabId)
    void rooms.tabClosed(tabId)
  })
  // Another video on the same player moves the tab's party there (rooms.tabUrlChanged
  // tells the viewer's own change from a navigation we started); leaving the player
  // leaves the party. Off our sites the URL is hidden from us (no host permission);
  // that counts as leaving.
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.url !== undefined || change.status === 'loading') {
      void rooms.tabUrlChanged(tabId, tab.url ?? '')
    }
  })
  // Reconnect parties that were live before this worker was stopped.
  void session.load().then(rooms.restore)

  // Each open side panel says which tab (and view) it shows, so chat can count unread
  // messages and the pill knows whether to show bubbles. The port closing means the
  // panel closed.
  const extensionOrigin = chrome.runtime.getURL('')
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PANEL_PORT || !port.sender?.url?.startsWith(extensionOrigin)) {
      port.disconnect()
      return
    }
    const changed = (tabIds: number[]) => {
      for (const tabId of tabIds) void rooms.panelChanged(tabId)
    }
    port.onMessage.addListener((report: unknown) => {
      if (isPanelReport(report)) changed(panels.update(port, report))
    })
    port.onDisconnect.addListener(() => changed(panels.remove(port)))
  })

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    // chrome.sidePanel.open only works while the click's user gesture is current, so this
    // one is handled straight away (no await first). It needs no session.
    if ((message as { type?: unknown } | null)?.type === 'party:open-panel') {
      void handle(message, sender).then(reply, () => reply(undefined))
      return true
    }
    void session
      .load()
      .then(() => handle(message, sender))
      .then(reply, () => reply(undefined))
    return true // keep the channel open for the async reply
  })
})
