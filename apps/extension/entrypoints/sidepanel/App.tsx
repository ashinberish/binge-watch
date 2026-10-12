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

import { HistoryList, type LoadHistory } from '../../src/features/history/HistoryList'
import { PartyPanel } from '../../src/features/party/PartyPanel'
import { PartyChat, PartyMembers, softAvatarStyle } from '../../src/features/party/PartyRoom'
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

type PanelTab = 'history' | 'chat' | 'members'

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
            <Avatar
              name={profile.name}
              color={profile.avatar_color}
              style={softAvatarStyle(profile.avatar_color)}
              className="nr-avatar--soft"
              size="sm"
              decorative
            />
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
  const [panelTab, setPanelTab] = useState<PanelTab>('history')
  const [profiles, reloadProfiles] = useAsync(() => send({ type: 'profiles:list' }), [])
  const room = usePartyRoom(tabId)
  const visible = usePageVisible()
  const party = room.view
  // "Reading the chat" is what clears unread messages and hides bubbles over the player.
  usePanelPresence(tabId, party !== null && panelTab === 'chat' && visible)

  // Open the chat when this tab joins a party; fall back to History when it ends.
  const partyCode = party?.code ?? null
  useEffect(() => {
    setPanelTab(partyCode ? 'chat' : 'history')
  }, [partyCode])

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
        {party ? null : <PartyPanel tabId={tabId} />}
        {listed.profiles.length > 1 ? (
          <ProfileSwitcher
            profiles={listed.profiles}
            activeProfileId={activeProfileId}
            onSelect={(id) => void select(id)}
          />
        ) : null}
        <Activity profileId={activeProfileId} titled={!party} />
      </>
    )
  }

  const unread = party && panelTab !== 'chat' ? party.unread : 0

  const header = <Header account={{ profile: active, onSignOut: () => void signOut() }} />

  if (!party) {
    return (
      <main className="nr-panel">
        {header}
        <div className="nr-panel__stack">{home}</div>
      </main>
    )
  }

  return (
    <main className="nr-panel nr-panel--fill">
      {header}
      <Tabs
        value={panelTab}
        onValueChange={(value) => setPanelTab(value as PanelTab)}
        className="nr-panel__tabs"
      >
        <TabsList aria-label="Nightreel">
          <TabsTrigger value="chat">
            Chat
            {unread > 0 ? (
              <span className="nr-tab-count nr-tab-count--unread">
                {unread > 99 ? '99+' : unread}
                <span className="nr-visually-hidden"> unread</span>
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="members">
            Members
            <span className="nr-tab-count">{party.members.length || party.memberCount}</span>
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="nr-panel__tab nr-panel__tab--chat">
          <PartyChat
            youId={party.youId}
            chat={party.chat}
            system={party.system}
            connection={party.status === 'invited' ? 'connecting' : party.status}
            error={room.error}
            onSend={room.sendChat}
            onReact={room.react}
            onClearError={room.clearError}
          />
        </TabsContent>
        <TabsContent value="members" className="nr-panel__tab nr-panel__stack">
          <PartyMembers members={party.members} youId={party.youId} />
          <PartyPanel tabId={tabId} />
        </TabsContent>
        <TabsContent value="history" className="nr-panel__tab nr-panel__stack">
          {home}
        </TabsContent>
      </Tabs>
    </main>
  )
}

const loadHistory: LoadHistory = (cursor) =>
  send(cursor ? { type: 'history:list', cursor } : { type: 'history:list' })

/** The streak line and the active profile's watch history. */
function Activity({ profileId, titled }: { profileId: string; titled: boolean }) {
  const [streak] = useAsync(() => send({ type: 'streak:get' }), [profileId])
  const episodesToday =
    streak.status === 'done' && streak.data.ok ? streak.data.data.episodes_today : 0

  return (
    <section className="nr-panel__section" aria-labelledby="history-title">
      <h2 id="history-title" className={titled ? 'nr-panel__title' : 'nr-visually-hidden'}>
        History
      </h2>
      <StreakLine episodesToday={episodesToday} />
      <HistoryList profileId={profileId} load={loadHistory} />
    </section>
  )
}
