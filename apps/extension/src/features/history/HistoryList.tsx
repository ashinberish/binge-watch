import { progressRatio, timeLeft } from '@nightreel/shared'
import { Button, Icon, Progress, Skeleton } from '@nightreel/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import { appendPage, groupByDay, historyMeta, nextCursor } from '../../lib/history'
import { failureMessage, type Failure, type Result } from '../../lib/result'
import type { HistoryItem } from '../../lib/types'

export type LoadHistory = (cursor: string | null) => Promise<Result<HistoryItem[]>>

interface HistoryState {
  items: HistoryItem[]
  /** First page loading. */
  loading: boolean
  /** "Load more" in flight. */
  loadingMore: boolean
  error: Failure | null
  cursor: string | null
}

const INITIAL: HistoryState = {
  items: [],
  loading: true,
  loadingMore: false,
  error: null,
  cursor: null,
}

/** Pages through the profile's watch history; starts over when `profileId` changes. */
export function useHistory(profileId: string, load: LoadHistory) {
  const [state, setState] = useState<HistoryState>(INITIAL)
  const generation = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load

  const fetchPage = useCallback(async (cursor: string | null) => {
    const run = generation.current
    let result: Result<HistoryItem[]>
    try {
      result = await loadRef.current(cursor)
    } catch {
      result = { ok: false, error: 'rejected' }
    }
    if (run !== generation.current) return // the profile changed meanwhile
    setState((current) =>
      result.ok
        ? {
            items: cursor ? appendPage(current.items, result.data) : result.data,
            loading: false,
            loadingMore: false,
            error: null,
            cursor: nextCursor(result.data),
          }
        : { ...current, loading: false, loadingMore: false, error: result.error },
    )
  }, [])

  useEffect(() => {
    generation.current += 1
    setState(INITIAL)
    void fetchPage(null)
  }, [profileId, fetchPage])

  const stateRef = useRef(state)
  stateRef.current = state
  const loadMore = useCallback(() => {
    const { cursor, loadingMore } = stateRef.current
    if (!cursor || loadingMore) return
    setState((current) => ({ ...current, loadingMore: true, error: null }))
    void fetchPage(cursor)
  }, [fetchPage])

  return { ...state, loadMore }
}

function HistoryRow({ item }: { item: HistoryItem }) {
  const left = timeLeft(item.position_seconds, item.duration_seconds)
  return (
    <li className="nr-history__row">
      <span className="nr-history__show">{item.show_title}</span>
      <span className="nr-history__meta">{historyMeta(item)}</span>
      {item.completed ? (
        <span className="nr-history__done">
          <Icon icon="check" size="extension" />
          Watched
        </span>
      ) : (
        <span className="nr-history__progress">
          <Progress
            size="sm"
            value={progressRatio(item.position_seconds, item.duration_seconds)}
            label={`${item.show_title} progress`}
            valueText={left}
          />
          <span className="nr-history__left">{left}</span>
        </span>
      )}
    </li>
  )
}

interface Props {
  profileId: string
  load: LoadHistory
  /** Local time, for "Today" and "Yesterday"; injectable for tests. */
  now?: () => Date
}

/**
 * What the active profile watched, newest first, grouped by day. Rows are plain text:
 * there are no deep links into the streaming services yet.
 */
export function HistoryList({ profileId, load, now = () => new Date() }: Props) {
  const history = useHistory(profileId, load)

  if (history.loading) {
    return (
      <div className="nr-history" aria-busy="true" aria-label="Loading watch history">
        {[0, 1, 2].map((i) => (
          <div key={i} className="nr-history__row">
            <Skeleton shape="text" width="55%" />
            <Skeleton shape="text" width="40%" />
            <Skeleton shape="rect" height={2} />
          </div>
        ))}
      </div>
    )
  }
  if (history.items.length === 0) {
    return history.error ? (
      <p className="nr-panel__error">{failureMessage(history.error)}</p>
    ) : (
      <p className="nr-panel__empty">Episodes you watch show up here.</p>
    )
  }

  return (
    <div className="nr-history">
      {groupByDay(history.items, now()).map((day) => (
        <section key={day.key} className="nr-history__day" aria-label={day.label}>
          <h3 className="nr-history__day-title">{day.label}</h3>
          <ul className="nr-history__list">
            {day.items.map((item) => (
              <HistoryRow key={`${item.episode_id}@${item.updated_at}`} item={item} />
            ))}
          </ul>
        </section>
      ))}
      {history.error ? <p className="nr-panel__error">{failureMessage(history.error)}</p> : null}
      {history.cursor ? (
        <div>
          <Button
            size="sm"
            variant="ghost"
            loading={history.loadingMore}
            onClick={history.loadMore}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  )
}
