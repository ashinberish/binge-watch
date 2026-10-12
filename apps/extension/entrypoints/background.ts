import { createHandler } from '../src/background/handler'
import { forgetTab, rooms, scheduler, services } from '../src/background/services'
import { session } from '../src/lib/api'

const SYNC_ALARM = 'nightreel:sync'

export default defineBackground(() => {
  const handle = createHandler(services, chrome.runtime.getURL(''))

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
  // Navigating a party tab to another video (or away from the player) leaves the party.
  // Off our sites the URL is hidden from us (no host permission); that counts as leaving.
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.url !== undefined || change.status === 'loading') {
      void rooms.tabUrlChanged(tabId, tab.url ?? '')
    }
  })
  // Reconnect parties that were live before this worker was stopped.
  void session.load().then(rooms.restore)

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    void session
      .load()
      .then(() => handle(message, sender))
      .then(reply, () => reply(undefined))
    return true // keep the channel open for the async reply
  })
})
