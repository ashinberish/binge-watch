/**
 * Estimates the offset between this machine's clock and the party server's, from
 * ping/pong round trips (NTP-style): the server read its clock roughly halfway through
 * the round trip, so offset ≈ server_time − (sent + received) / 2.
 *
 * Samples are smoothed with an exponential moving average, and a sample whose round
 * trip is much slower than the best seen is skipped (its midpoint guess is poor). A run
 * of slow samples is accepted anyway, since the network itself may have got slower.
 */

export interface ClockEstimator {
  /** Records one ping/pong. Times are local epoch ms; `serverTime` is server epoch seconds. */
  sample(sentAtMs: number, receivedAtMs: number, serverTime: number): void
  /** Server clock minus local clock, in ms. 0 until the first sample. */
  offsetMs(): number
  /** Server epoch seconds at local time `localMs`. */
  serverNow(localMs: number): number
  /** True once at least one sample was accepted. */
  ready(): boolean
}

export interface ClockOptions {
  /** Weight of a new sample in the moving average (0–1]. */
  alpha?: number
  /** A sample is an outlier when its round trip exceeds this × the best round trip… */
  outlierFactor?: number
  /** …plus this many ms of slack, so tiny best round trips do not reject everything. */
  outlierSlackMs?: number
  /** Accept a sample anyway after this many outliers in a row. */
  maxSkipped?: number
}

export function createClockEstimator({
  alpha = 0.25,
  outlierFactor = 2,
  outlierSlackMs = 50,
  maxSkipped = 3,
}: ClockOptions = {}): ClockEstimator {
  let offset: number | null = null
  let bestRtt = Number.POSITIVE_INFINITY
  let skipped = 0

  return {
    sample(sentAtMs, receivedAtMs, serverTime) {
      const rtt = receivedAtMs - sentAtMs
      if (!Number.isFinite(rtt) || rtt < 0 || !Number.isFinite(serverTime)) return
      const measured = serverTime * 1000 - (sentAtMs + receivedAtMs) / 2

      if (offset !== null && rtt > bestRtt * outlierFactor + outlierSlackMs) {
        skipped += 1
        if (skipped <= maxSkipped) return
        // The network got slower for good: start trusting the new round trips.
        bestRtt = rtt
      }
      skipped = 0
      bestRtt = Math.min(bestRtt, rtt)
      offset = offset === null ? measured : offset + alpha * (measured - offset)
    },
    offsetMs: () => offset ?? 0,
    serverNow: (localMs) => (localMs + (offset ?? 0)) / 1000,
    ready: () => offset !== null,
  }
}
