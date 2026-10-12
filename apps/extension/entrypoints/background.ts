import { adapterFor } from '../src/adapters/registry'
import { loadSession, setAccessToken } from '../src/lib/api'
import type { Message, SessionState } from '../src/messaging/protocol'
import { sessionStore } from '../src/storage'
import { flush, push } from '../src/sync/queue'

const SYNC_ALARM = 'nightreel:sync'

export default defineBackground(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 })
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void flush()
  })

  chrome.runtime.onMessage.addListener((message: Message, sender, reply) => {
    void handle(message, sender).then(reply)
    return true // keep the channel open for the async reply
  })
})

async function handle(message: Message, sender: chrome.runtime.MessageSender) {
  switch (message.type) {
    case 'progress': {
      // Only accept progress from tabs on players we actually support.
      if (!sender.tab?.url || !adapterFor(sender.tab.url)) return { ok: false }
      await push({ adapter: message.adapter, snapshot: message.snapshot, queuedAt: Date.now() })
      return { ok: true }
    }
    case 'session:get':
      return sessionState()
    case 'session:sign-in':
      // TODO(phase 3): chrome.identity.launchWebAuthFlow against the web app's /extension/connect
      return sessionState()
    case 'session:sign-out':
      await sessionStore.clear()
      setAccessToken(null)
      return { ok: true }
  }
}

async function sessionState(): Promise<SessionState> {
  const token = await loadSession()
  const { displayName } = await sessionStore.get()
  return { signedIn: token !== null, displayName: displayName ?? null }
}
