import { describe, expect, it, vi } from 'vitest'

import {
  createSyncEngine,
  ECHO_WINDOW_MS,
  planSync,
  REPORT_GRACE_MS,
  type VideoLike,
} from '../../src/party/engine'
import { NUDGE_MS } from '../../src/party/position'
import { playbackState as state } from './fixtures'

// Room state: playing from 100 s at server time 1000 s. Local clock is at 1005 s, so the
// room expects 105 s (offset 0) unless a test says otherwise.
const START_MS = 1_005_000

type VideoInit = Partial<Pick<VideoLike, 'paused' | 'currentTime' | 'playbackRate'>>

function fakeVideo(init: VideoInit = {}) {
  const video = {
    paused: true,
    currentTime: 0,
    playbackRate: 1,
    play: vi.fn(async () => {
      video.paused = false
    }),
    pause: vi.fn(() => {
      video.paused = true
    }),
    ...init,
  }
  return video
}

function setup(init: VideoInit = {}) {
  const clock = { now: START_MS, ad: false }
  const video = fakeVideo(init)
  const report = vi.fn()
  const onAutoplayBlocked = vi.fn()
  const engine = createSyncEngine({
    now: () => clock.now,
    isAd: () => clock.ad,
    report,
    onAutoplayBlocked,
  })
  engine.setVideo(video)
  return { clock, video, report, onAutoplayBlocked, engine }
}

describe('planSync', () => {
  const local = { paused: false, currentTime: 105, playbackRate: 1 }

  it('does nothing when already in step', () => {
    expect(planSync(state(), local, 1_005)).toEqual({
      rate: null,
      pause: false,
      seekTo: null,
      nudgeRate: null,
      play: false,
    })
  })

  it('plans pause, rate and play changes', () => {
    expect(planSync(state({ paused: true, position: 105 }), local, 1_005)).toMatchObject({
      pause: true,
      play: false,
    })
    expect(
      planSync(state({ rate: 1.5 }), { ...local, paused: true, currentTime: 107.5 }, 1_005),
    ).toMatchObject({ rate: 1.5, play: true, seekTo: null })
  })

  it('does not nudge while buffering', () => {
    expect(
      planSync(state(), { ...local, currentTime: 104.5 }, 1_005, { buffering: true }).nudgeRate,
    ).toBeNull()
  })
})

describe('sync engine', () => {
  it('brings a late joiner to the room: seek, then play, without echoing either', async () => {
    const { engine, video, report } = setup({ paused: true, currentTime: 0 })
    expect(engine.receive(state(), 0)).toBe(true)
    expect(video.currentTime).toBe(105)
    expect(video.play).toHaveBeenCalledOnce()
    await Promise.resolve()

    engine.handleEvent('seeked')
    engine.handleEvent('play')
    expect(report).not.toHaveBeenCalled()
  })

  it('uses the clock offset to work out where the room is', () => {
    const { engine, video } = setup({ paused: false, currentTime: 0 })
    engine.receive(state(), 2_000) // the server clock is 2 s ahead
    expect(video.currentTime).toBe(107)
  })

  it('hard-seeks beyond a second, nudges between 0.3 and 1 s, and leaves tiny gaps', () => {
    const far = setup({ paused: false, currentTime: 103 })
    far.engine.receive(state(), 0)
    expect(far.video.currentTime).toBe(105)
    expect(far.engine.nudging).toBe(false)

    const near = setup({ paused: false, currentTime: 104.5 })
    near.engine.receive(state(), 0)
    expect(near.video.currentTime).toBe(104.5) // no seek
    expect(near.video.playbackRate).toBeCloseTo(1.05)
    expect(near.engine.nudging).toBe(true)

    const ahead = setup({ paused: false, currentTime: 105.6 })
    ahead.engine.receive(state(), 0)
    expect(ahead.video.playbackRate).toBeCloseTo(0.95)

    const close = setup({ paused: false, currentTime: 105.2 })
    close.engine.receive(state(), 0)
    expect(close.video.currentTime).toBe(105.2)
    expect(close.video.playbackRate).toBe(1)
  })

  it('restores the speed once a nudge has run its course', () => {
    const { engine, video, clock } = setup({ paused: false, currentTime: 104.5 })
    engine.receive(state(), 0)
    clock.now += NUDGE_MS - 1
    engine.tick()
    expect(video.playbackRate).toBeCloseTo(1.05)
    clock.now += 1
    video.currentTime = 108 // caught up with the room
    engine.tick()
    expect(video.playbackRate).toBe(1)
    expect(engine.nudging).toBe(false)
  })

  it('ignores states that are not newer than the last one applied', () => {
    const { engine, video } = setup({ paused: false, currentTime: 105 })
    engine.receive(state({ seq: 5 }), 0)
    expect(engine.receive(state({ seq: 4, paused: true }), 0)).toBe(false)
    expect(engine.receive(state({ seq: 5, paused: true }), 0)).toBe(false)
    expect(video.pause).not.toHaveBeenCalled()
    expect(engine.receive(state({ seq: 6, paused: true, position: 105 }), 0)).toBe(true)
    expect(video.pause).toHaveBeenCalledOnce()
    expect(engine.lastSeq).toBe(6)
  })

  it('suppresses the echo of a remote pause but reports the viewer’s own pause later', () => {
    const { engine, video, report, clock } = setup({ paused: false, currentTime: 105 })
    engine.receive(state({ paused: true, position: 105 }), 0)
    expect(video.pause).toHaveBeenCalledOnce()
    engine.handleEvent('pause')
    expect(report).not.toHaveBeenCalled()

    // The viewer plays and pauses again, after the echo window.
    clock.now += ECHO_WINDOW_MS + 1
    video.paused = false
    engine.handleEvent('play')
    video.currentTime = 106
    video.paused = true
    engine.handleEvent('pause')
    expect(report.mock.calls).toEqual([
      [{ action: 'play', position: 105, rate: 1 }],
      [{ action: 'pause', position: 106, rate: 1 }],
    ])
  })

  it('reports a seek that does not match the one it just applied', () => {
    const { engine, video, report } = setup({ paused: false, currentTime: 50 })
    engine.receive(state(), 0) // seeks to 105
    video.currentTime = 300 // the viewer drags elsewhere before our seek lands
    engine.handleEvent('seeked')
    expect(report).toHaveBeenCalledWith({ action: 'seek', position: 300, rate: 1 })
  })

  it('reports the room speed, not the nudge, with a local action', () => {
    const { engine, video, report, clock } = setup({ paused: false, currentTime: 104.5 })
    engine.receive(state(), 0)
    clock.now += ECHO_WINDOW_MS + 1
    video.paused = true
    engine.handleEvent('pause')
    expect(report).toHaveBeenCalledWith({ action: 'pause', position: 104.5, rate: 1 })
  })

  it('never acts or reports during an ad, and catches up when it ends', () => {
    const { engine, video, report, clock } = setup({ paused: false, currentTime: 12 })
    clock.ad = true
    engine.receive(state(), 0)
    expect(video.currentTime).toBe(12)
    engine.handleEvent('pause')
    engine.handleEvent('seeked')
    engine.tick()
    expect(report).not.toHaveBeenCalled()
    expect(video.currentTime).toBe(12)

    clock.ad = false
    engine.tick()
    expect(video.currentTime).toBe(105)
  })

  it('treats buffering as buffering, not as a pause', () => {
    const { engine, video, report, clock } = setup({ paused: false, currentTime: 105 })
    engine.receive(state(), 0)
    engine.handleEvent('waiting')
    engine.handleEvent('stalled')
    clock.now += 5_000 // the room moved on to 110 while we were stuck at 105
    engine.tick()
    expect(video.currentTime).toBe(105)
    expect(report).not.toHaveBeenCalled()

    engine.handleEvent('playing')
    engine.tick()
    expect(video.currentTime).toBe(110)
  })

  it('corrects drift on tick, but not right after the viewer’s own action', () => {
    const { engine, video, clock } = setup({ paused: false, currentTime: 105 })
    engine.receive(state(), 0)
    clock.now += ECHO_WINDOW_MS + 1
    video.currentTime = 400
    engine.handleEvent('seeked') // reported; the room has not echoed it yet
    engine.tick()
    expect(video.currentTime).toBe(400)

    clock.now += REPORT_GRACE_MS
    engine.tick()
    expect(video.currentTime).toBeCloseTo(108, 0) // back to the room, no echo ever came
  })

  it('offers "Click to sync" when the browser blocks play, and syncs on the click', async () => {
    const { engine, video, onAutoplayBlocked, report } = setup({ paused: true, currentTime: 105 })
    video.play.mockRejectedValueOnce(
      Object.assign(new Error('blocked'), { name: 'NotAllowedError' }),
    )
    engine.receive(state(), 0)
    await vi.waitFor(() => expect(onAutoplayBlocked).toHaveBeenCalledWith(true))
    expect(engine.autoplayBlocked).toBe(true)

    engine.resync()
    expect(video.play).toHaveBeenCalledTimes(2)
    expect(onAutoplayBlocked).toHaveBeenLastCalledWith(false)
    expect(report).not.toHaveBeenCalled()
  })

  it('joins the room instead of broadcasting when the viewer presses play after a block', async () => {
    const { engine, video, onAutoplayBlocked, report, clock } = setup({
      paused: true,
      currentTime: 20,
    })
    video.play.mockRejectedValueOnce(
      Object.assign(new Error('blocked'), { name: 'NotAllowedError' }),
    )
    engine.receive(state(), 0)
    await vi.waitFor(() => expect(onAutoplayBlocked).toHaveBeenCalledWith(true))
    clock.now += ECHO_WINDOW_MS + 1
    video.paused = false
    engine.handleEvent('play')
    expect(report).not.toHaveBeenCalled()
    expect(engine.autoplayBlocked).toBe(false)
  })

  it('applies a state that arrived before the video existed once it appears', () => {
    const { engine } = setup()
    engine.setVideo(null)
    engine.receive(state(), 0)
    const video = fakeVideo({ paused: true, currentTime: 0 })
    engine.setVideo(video)
    engine.tick()
    expect(video.currentTime).toBe(105)
    expect(video.play).toHaveBeenCalled()
  })

  it('restores normal speed when the party is left mid-nudge', () => {
    const { engine, video } = setup({ paused: false, currentTime: 104.5 })
    engine.receive(state(), 0)
    engine.dispose()
    expect(video.playbackRate).toBe(1)
  })

  it('seeds a fresh room from this player instead of jumping to 0:00', () => {
    const fresh = state({ paused: true, position: 0, updated_at: 0, seq: 0, by: null })
    const playing = setup({ paused: false, currentTime: 734 })
    playing.engine.receive(fresh, 0)
    expect(playing.video.currentTime).toBe(734)
    expect(playing.video.pause).not.toHaveBeenCalled()
    expect(playing.report).toHaveBeenCalledWith({ action: 'play', position: 734, rate: 1 })

    // The echo of the seed is applied like any other state.
    playing.engine.receive(state({ position: 734, updated_at: 1_005, seq: 1 }), 0)
    expect(playing.video.currentTime).toBe(734)

    const paused = setup({ paused: true, currentTime: 60 })
    paused.engine.receive(fresh, 0)
    expect(paused.report).toHaveBeenCalledWith({ action: 'pause', position: 60, rate: 1 })
  })

  it('waits for the ad (or the video) before seeding a fresh room', () => {
    const { engine, report, clock } = setup({ paused: false, currentTime: 30 })
    clock.ad = true
    engine.receive(state({ seq: 0, by: null }), 0)
    expect(report).not.toHaveBeenCalled()
    clock.ad = false
    engine.tick()
    expect(report).toHaveBeenCalledOnce()
    engine.tick()
    expect(report).toHaveBeenCalledOnce()
  })
})
