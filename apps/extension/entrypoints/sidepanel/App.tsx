import {
  Avatar,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@nightreel/ui'
import { useEffect, useState } from 'react'

import { ContinueWatchingList } from '../../src/features/continue-watching/ContinueWatchingList'
import { EpisodeList } from '../../src/features/episodes/EpisodeList'
import { PartyPanel } from '../../src/features/party/PartyPanel'
import { PartyRoom } from '../../src/features/party/PartyRoom'
import {
  usePageVisible,
  usePanelPresence,
  usePartyRoom,
} from '../../src/features/party/usePartyRoom'
import { NoProfiles, ProfileSwitcher } from '../../src/features/profiles/ProfileSwitcher'
import { SignInPanel } from '../../src/features/session/SignInPanel'
import { StreakLine } from '../../src/features/streaks/StreakLine'
import { env } from '../../src/lib/env'
import { failureMessage } from '../../src/lib/result'
import type { Profile } from '../../src/lib/types'
import { onBroadcast, send, type SessionState } from '../../src/messaging/protocol'
import { useAsync } from '../../src/messaging/useAsync'

type PanelTab = 'home' | 'party' | 'episodes'

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

/** The side panel is the extension's whole UI: the toolbar button opens it. */
export function App() {
  const [session, reload] = useAsync(() => send({ type: 'session:get' }), [])
  const [override, setOverride] = useState<SessionState | null>(null)

  useEffect(
    () =>
      onBroadcast((message) => {
        if (message.type === 'session:changed') {
          setOverride(null)
          reload()
        }
      }),
    [reload],
  )

  const current = override ?? (session.status === 'done' ? session.data : null)

  if (session.status === 'error') {
    return (
      <main className="nr-panel">
        <Header />
        <p className="nr-panel__error">{failureMessage('rejected')}</p>
      </main>
    )
  }
  if (!current) {
    return (
      <main className="nr-panel" aria-busy="true">
        <Header />
        <Skeleton shape="text" width="50%" />
        <Skeleton shape="rect" height={64} />
      </main>
    )
  }
  if (!current.signedIn) {
    return (
      <main className="nr-panel">
        <Header />
        <SignInPanel onSignedIn={setOverride} />
      </main>
    )
  }
  return <SignedIn onSignedOut={() => setOverride({ signedIn: false, displayName: null })} />
}

function Header({ account }: { account?: AccountMenuProps }) {
  return (
    <header className="nr-panel__header">
      <span className="nr-wordmark">
        nightreel<span className="nr-wordmark__dot">.</span>
      </span>
      {account ? <AccountMenu {...account} /> : null}
    </header>
  )
}

interface AccountMenuProps {
  profile: Profile | null
  onSignOut: () => void
}

function AccountMenu({ profile, onSignOut }: AccountMenuProps) {
  return (
    <Menu>
      <MenuTrigger asChild>
        {profile ? (
          <button
            type="button"
            className="nr-panel__account"
            aria-label={`Account menu for ${profile.name}`}
          >
            <Avatar name={profile.name} color={profile.avatar_color} size="sm" decorative />
          </button>
        ) : (
          <IconButton icon="user" size="sm" variant="ghost" aria-label="Account menu" />
        )}
      </MenuTrigger>
      <MenuContent align="end">
        {profile ? <MenuLabel>{profile.name}</MenuLabel> : null}
        <MenuItem icon="users" onSelect={() => void chrome.tabs.create({ url: env.webUrl })}>
          Open Nightreel
        </MenuItem>
        <MenuItem icon="settings" onSelect={() => void chrome.runtime.openOptionsPage()}>
          Settings
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="log-out" onSelect={onSignOut}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

function useActiveTab() {
  const [tabId, setTabId] = useState<number | null>(null)
  useEffect(() => {
    void activeTabId().then(setTabId)
    const onActivated = (info: chrome.tabs.OnActivatedInfo) => setTabId(info.tabId)
    const onFocus = (windowId: number) => {
      if (windowId !== chrome.windows.WINDOW_ID_NONE) void activeTabId().then(setTabId)
    }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.windows.onFocusChanged.addListener(onFocus)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.windows.onFocusChanged.removeListener(onFocus)
    }
  }, [])
  return tabId
}

function SignedIn({ onSignedOut }: { onSignedOut: () => void }) {
  const tabId = useActiveTab()
  const [version, setVersion] = useState(0)
  const [panelTab, setPanelTab] = useState<PanelTab>('home')
  const [profiles, reloadProfiles] = useAsync(() => send({ type: 'profiles:list' }), [])
  const room = usePartyRoom(tabId)
  const visible = usePageVisible()
  const party = room.view
  usePanelPresence(tabId, party !== null && panelTab === 'party' && visible)

  useEffect(
    () =>
      onBroadcast((message) => {
        if (message.type === 'episode:changed' && message.tabId === tabId) {
          setVersion((v) => v + 1)
        }
      }),
    [tabId],
  )

  // Open the Party tab when this tab joins a party; fall back to Home when it ends.
  const partyCode = party?.code ?? null
  useEffect(() => {
    if (partyCode) setPanelTab('party')
    else setPanelTab((tab) => (tab === 'party' ? 'home' : tab))
  }, [partyCode])

  const [episode] = useAsync(async () => {
    const match = tabId === null ? null : await send({ type: 'episode:for-tab', tabId })
    if (!match) return null
    const show = await send({ type: 'show:get', showId: match.show_id })
    return { match, show }
  }, [tabId, version])
  const current = episode.status === 'done' ? episode.data : null

  useEffect(() => {
    if (!current) setPanelTab((tab) => (tab === 'episodes' ? 'home' : tab))
  }, [current])

  const listed = profiles.status === 'done' && profiles.data.ok ? profiles.data.data : null
  const activeProfileId = listed?.activeProfileId ?? null
  const active = listed?.profiles.find((p) => p.id === activeProfileId) ?? null

  async function signOut() {
    await send({ type: 'session:sign-out' }).catch(() => undefined)
    onSignedOut()
  }

  async function select(profileId: string) {
    await send({ type: 'profile:set', profileId }).catch(() => undefined)
    reloadProfiles()
  }

  let home
  if (profiles.status === 'loading') {
    home = (
      <div aria-busy="true" aria-label="Loading profiles">
        <Skeleton shape="rect" height={32} />
      </div>
    )
  } else if (!listed) {
    const error = profiles.status === 'done' && !profiles.data.ok ? profiles.data.error : 'rejected'
    home = <p className="nr-panel__error">{failureMessage(error)}</p>
  } else if (listed.profiles.length === 0 || !activeProfileId) {
    home = <NoProfiles webUrl={env.webUrl} />
  } else {
    home = (
      <>
        {listed.profiles.length > 1 ? (
          <ProfileSwitcher
            profiles={listed.profiles}
            activeProfileId={activeProfileId}
            onSelect={(id) => void select(id)}
          />
        ) : null}
        <PartyPanel tabId={tabId} />
        <Activity profileId={activeProfileId} />
      </>
    )
  }

  const unread = party && panelTab !== 'party' ? party.unread : 0

  return (
    <main className="nr-panel">
      <Header account={{ profile: active, onSignOut: () => void signOut() }} />
      <Tabs
        value={panelTab}
        onValueChange={(value) => setPanelTab(value as PanelTab)}
        className="nr-panel__tabs"
      >
        <TabsList aria-label="Nightreel">
          <TabsTrigger value="home">Home</TabsTrigger>
          {party ? (
            <TabsTrigger value="party">
              Party
              {unread > 0 ? <span className="nr-tab-count"> · {unread} new</span> : null}
            </TabsTrigger>
          ) : null}
          {current ? <TabsTrigger value="episodes">Episodes</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="home" className="nr-panel__stack">
          {home}
        </TabsContent>
        {party ? (
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
        ) : null}
        {current ? (
          <TabsContent value="episodes" className="nr-panel__stack">
            <h1 className="nr-panel__title">{current.match.show_title}</h1>
            {current.show.ok ? (
              <EpisodeList show={current.show.data} currentEpisodeId={current.match.episode_id} />
            ) : (
              <p className="nr-panel__error">{failureMessage(current.show.error)}</p>
            )}
          </TabsContent>
        ) : null}
      </Tabs>
    </main>
  )
}

/** Continue watching and the streak line for the active profile. */
function Activity({ profileId }: { profileId: string }) {
  const [history] = useAsync(() => send({ type: 'history:continue' }), [profileId])
  const [streak] = useAsync(() => send({ type: 'streak:get' }), [profileId])
  const episodesToday =
    streak.status === 'done' && streak.data.ok ? streak.data.data.episodes_today : 0

  return (
    <section className="nr-panel__section" aria-labelledby="cw-title">
      <h2 id="cw-title" className="nr-panel__title">
        Continue watching
      </h2>
      <StreakLine episodesToday={episodesToday} />
      <ContinueWatchingList state={history} />
    </section>
  )
}
