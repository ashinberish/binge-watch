import { createHandler } from '../src/background/handler'
import { forgetTab, scheduler, services } from '../src/background/services'
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

  chrome.tabs.onRemoved.addListener((tabId) => void forgetTab(tabId))

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    void session
      .load()
      .then(() => handle(message, sender))
      .then(reply, () => reply(undefined))
    return true // keep the channel open for the async reply
  })
})
