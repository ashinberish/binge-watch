import '@nightreel/ui/styles.css'
import '../../src/styles/pages.css'
import './sidepanel.css'

import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@nightreel/ui'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { EpisodeList } from '../../src/features/episodes/EpisodeList'
import { PartyRoom } from '../../src/features/party/PartyRoom'
import {
  usePageVisible,
  usePanelPresence,
  usePartyRoom,
} from '../../src/features/party/usePartyRoom'
import { StreakLine } from '../../src/features/streaks/StreakLine'
import { failureMessage } from '../../src/lib/result'
import { onBroadcast, send } from '../../src/messaging/protocol'
import { useAsync } from '../../src/messaging/useAsync'

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

type PanelTab = 'party' | 'episodes'

function SidePanel() {
  const [tabId, setTabId] = useState<number | null>(null)
  const [version, setVersion] = useState(0)
  const [panelTab, setPanelTab] = useState<PanelTab>('party')
  const room = usePartyRoom(tabId)
  const visible = usePageVisible()
  const party = room.view
  usePanelPresence(tabId, party !== null && panelTab === 'party' && visible)

  useEffect(() => {
    void activeTabId().then(setTabId)
    const onActivated = (info: chrome.tabs.OnActivatedInfo) => setTabId(info.tabId)
    chrome.tabs.onActivated.addListener(onActivated)
    const off = onBroadcast((message) => {
      if (message.type === 'session:changed') setVersion((v) => v + 1)
      if (message.type === 'episode:changed') {
        void activeTabId().then((id) => {
          if (id === message.tabId) {
            setTabId(id)
            setVersion((v) => v + 1)
          }
        })
      }
    })
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      off()
    }
  }, [])

  const [view] = useAsync(async () => {
    const session = await send({ type: 'session:get' })
    if (!session.signedIn) return { kind: 'signed-out' as const }
    const match = tabId === null ? null : await send({ type: 'episode:for-tab', tabId })
    if (!match) return { kind: 'idle' as const }
    const [show, streak] = await Promise.all([
      send({ type: 'show:get', showId: match.show_id }),
      send({ type: 'streak:get' }),
    ])
    return { kind: 'show' as const, match, show, streak }
  }, [tabId, version])

  let body
  if (view.status === 'loading') {
    body = (
      <div className="nr-popup__section" aria-busy="true" aria-label="Loading episodes">
        <Skeleton shape="text" width="60%" />
        <Skeleton shape="rect" height={160} />
      </div>
    )
  } else if (view.status === 'error') {
    body = <p className="nr-popup__error">{failureMessage('rejected')}</p>
  } else if (view.data.kind === 'signed-out') {
    body = (
      <p className="nr-popup__muted">
        Sign in from the Nightreel button in your toolbar to see episodes here.
      </p>
    )
  } else if (view.data.kind === 'idle') {
    body = (
      <p className="nr-popup__muted">Open a show on a supported site to see its episodes here.</p>
    )
  } else {
    const { match, show, streak } = view.data
    body = (
      <>
        <h1 className="nr-popup__title">{match.show_title}</h1>
        {streak.ok ? <StreakLine episodesToday={streak.data.episodes_today} /> : null}
        {show.ok ? (
          <EpisodeList show={show.data} currentEpisodeId={match.episode_id} />
        ) : (
          <p className="nr-popup__error">{failureMessage(show.error)}</p>
        )}
      </>
    )
  }

  const header = (
    <header className="nr-popup__header">
      <span className="nr-wordmark">
        nightreel<span className="nr-wordmark__dot">.</span>
      </span>
    </header>
  )

  if (!party) {
    return (
      <main className="nr-popup">
        {header}
        {body}
      </main>
    )
  }

  const unread = panelTab === 'party' ? 0 : party.unread
  return (
    <main className="nr-popup">
      {header}
      <Tabs
        value={panelTab}
        onValueChange={(value) => setPanelTab(value === 'episodes' ? 'episodes' : 'party')}
      >
        <TabsList aria-label="Side panel">
          <TabsTrigger value="party">
            Party
            {unread > 0 ? <span className="nr-tab-count"> · {unread} new</span> : null}
          </TabsTrigger>
          <TabsTrigger value="episodes">Episodes</TabsTrigger>
        </TabsList>
        <TabsContent value="party">
          <PartyRoom
            members={party.members}
            youId={party.youId}
            chat={party.chat}
            connection={party.status === 'invited' ? 'connecting' : party.status}
            error={room.error}
            onSend={room.sendChat}
            onReact={room.react}
            onClearError={room.clearError}
          />
        </TabsContent>
        <TabsContent value="episodes">
          <div className="nr-popup">{body}</div>
        </TabsContent>
      </Tabs>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
)
