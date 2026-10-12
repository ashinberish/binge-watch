import { Button } from '@nightreel/ui'
import { useEffect, useRef, useState } from 'react'

import { failureMessage } from '../../lib/result'
import { onBroadcast, send, type PartyTabView } from '../../messaging/protocol'
import { useAsync } from '../../messaging/useAsync'
import { membersLabel } from './overlay'

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Watch party controls for the active tab: "Start a watch party" on a matched player,
 * or the party's invite link and Leave once in one.
 */
export function PartyPanel() {
  const [tabId, setTabId] = useState<number | null>(null)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const tabRef = useRef<number | null>(null)

  useEffect(() => {
    void activeTabId().then((id) => {
      tabRef.current = id
      setTabId(id)
    })
    return onBroadcast((message) => {
      if (message.type === 'session:changed') setVersion((v) => v + 1)
      if (
        (message.type === 'party:changed' || message.type === 'episode:changed') &&
        message.tabId === tabRef.current
      ) {
        setVersion((v) => v + 1)
      }
    })
  }, [])

  const [view] = useAsync(async () => {
    if (tabId === null) return null
    const [party, match] = await Promise.all([
      send({ type: 'party:get-for-tab', tabId }),
      send({ type: 'episode:for-tab', tabId }),
    ])
    return { party: party?.status === 'invited' ? null : party, canStart: match !== null }
  }, [tabId, version])

  // Keep showing the last answer while a broadcast reloads it, so the panel does not flicker.
  const [data, setData] = useState<typeof view.data>(null)
  useEffect(() => {
    if (view.status === 'done') setData(view.data)
  }, [view])

  if (tabId === null || !data) return null
  const { party, canStart } = data

  async function start() {
    if (tabId === null) return
    setBusy(true)
    setNote(null)
    try {
      const result = await send({ type: 'party:start', tabId })
      if (!result.ok) {
        setNote({ text: failureMessage(result.error), error: true })
        return
      }
      const copied = await copy(result.data.inviteUrl)
      setNote({
        text: copied ? 'Invite link copied' : 'Copy the invite link below to invite friends.',
        error: false,
      })
      setVersion((v) => v + 1)
    } catch {
      setNote({ text: failureMessage('rejected'), error: true })
    } finally {
      setBusy(false)
    }
  }

  async function leave() {
    if (tabId === null) return
    setBusy(true)
    await send({ type: 'party:leave', tabId }).catch(() => undefined)
    setNote(null)
    setBusy(false)
    setVersion((v) => v + 1)
  }

  async function copyLink(party: PartyTabView) {
    const copied = await copy(party.inviteUrl)
    setNote(
      copied
        ? { text: 'Invite link copied', error: false }
        : { text: 'Could not copy. Select the link and copy it yourself.', error: true },
    )
  }

  const status = note ? (
    <p className={note.error ? 'nr-popup__error' : 'nr-popup__muted'} role="status">
      {note.text}
    </p>
  ) : null

  if (party) {
    return (
      <section className="nr-popup__section nr-party" aria-labelledby="party-title">
        <p id="party-title" className="nr-party__title">
          {membersLabel(party.memberCount)}
        </p>
        {party.status === 'reconnecting' ? <p className="nr-popup__muted">Reconnecting…</p> : null}
        <label className="nr-party__label" htmlFor="party-link">
          Invite link
        </label>
        <input
          id="party-link"
          className="nr-party__link"
          type="text"
          readOnly
          value={party.inviteUrl}
          onFocus={(event) => event.currentTarget.select()}
        />
        <div className="nr-party__actions">
          <Button size="sm" variant="secondary" onClick={() => void copyLink(party)}>
            Copy link
          </Button>
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void leave()}>
            Leave party
          </Button>
        </div>
        {status}
      </section>
    )
  }

  if (!canStart) return status
  return (
    <section className="nr-popup__section nr-party" aria-label="Watch party">
      <div className="nr-party__actions">
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void start()}>
          Start a watch party
        </Button>
      </div>
      {status}
    </section>
  )
}
