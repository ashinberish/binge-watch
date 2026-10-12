import { Card, CardBody, CardHeader, Select, Skeleton } from '@nightreel/ui'
import { useEffect, useState } from 'react'

import { adapters } from '../../adapters/registry'
import { COUNTDOWN_CHOICES } from '../../lib/settings'
import { send, type Settings } from '../../messaging/protocol'

const countdownOptions = COUNTDOWN_CHOICES.map((n) => ({
  value: String(n),
  label: `${n} seconds`,
}))

export function SettingsForm() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  useEffect(() => {
    send({ type: 'settings:get' }).then(setSettings, () => setStatus('error'))
  }, [])

  async function save(next: Partial<Settings>) {
    try {
      setSettings(await send({ type: 'settings:set', settings: next }))
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  return (
    <>
      <Card aria-labelledby="settings-countdown">
        <CardHeader
          id="settings-countdown"
          title="Next-episode countdown"
          description="How long the countdown runs before the next episode starts."
        />
        <CardBody>
          <div className="nr-settings__field">
            <span id="countdown-label" className="nr-settings__label">
              Countdown length
            </span>
            {settings ? (
              <Select
                aria-labelledby="countdown-label"
                options={countdownOptions}
                value={String(settings.countdownSeconds)}
                onValueChange={(value) => void save({ countdownSeconds: Number(value) })}
              />
            ) : (
              <Skeleton shape="rect" height={40} />
            )}
            <p role="status" className="nr-popup__muted">
              {status === 'saved' ? 'Saved.' : null}
              {status === 'error' ? 'Could not save your settings. Try again.' : null}
            </p>
          </div>
        </CardBody>
      </Card>
      <Card aria-labelledby="settings-sites">
        <CardHeader
          id="settings-sites"
          title="Supported sites"
          description="Nightreel follows episodes you play on these sites."
        />
        <CardBody>
          <ul className="nr-sites">
            {adapters.map((adapter) => (
              <li key={adapter.id} className="nr-sites__item">
                <span>{adapter.name}</span>
                <span className="nr-popup__muted">{adapter.site}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  )
}
