/** Why a background request did not produce data. The UI maps each one to a short sentence. */
export type Failure =
  | 'signed-out'
  | 'no-profile'
  | 'network'
  | 'server'
  | 'not-found'
  | 'rejected'
  | 'cancelled'
  /** A watch party already has as many members as it allows. */
  | 'full'

export type Result<T> = { ok: true; data: T } | { ok: false; error: Failure }

export const ok = <T>(data: T): Result<T> => ({ ok: true, data })
export const fail = <T = never>(error: Failure): Result<T> => ({ ok: false, error })

/** Maps an HTTP status to a failure. Callers handle 2xx before this. */
export function failureForStatus(status: number): Failure {
  if (status === 401) return 'signed-out'
  if (status === 404) return 'not-found'
  // Timeouts and rate limits are the API asking us to come back later.
  if (status >= 500 || status === 408 || status === 429) return 'server'
  return 'rejected'
}

interface FetchResult<T> {
  data?: T
  error?: unknown
  response: Response
}

/**
 * Runs an openapi-fetch call and folds every outcome into a Result. A thrown
 * TypeError is fetch's way of saying the network is down. `statuses` maps statuses
 * that mean something specific for this endpoint (e.g. 409 → 'full').
 */
export async function request<T>(
  call: () => Promise<FetchResult<T>>,
  statuses: Partial<Record<number, Failure>> = {},
): Promise<Result<T>> {
  try {
    const { data, error, response } = await call()
    if (!response.ok || error !== undefined) {
      return fail(statuses[response.status] ?? failureForStatus(response.status))
    }
    return ok(data as T)
  } catch {
    return fail('network')
  }
}

/** Viewer-facing sentence for a failure. Sentence case, no jargon. */
export function failureMessage(error: Failure): string {
  switch (error) {
    case 'signed-out':
      return 'Sign in to see this.'
    case 'no-profile':
      return 'Pick a profile first.'
    case 'network':
      return 'Cannot reach Nightreel. Check your connection.'
    case 'server':
      return 'Nightreel is having trouble right now. Try again in a moment.'
    case 'not-found':
      return 'We could not find that.'
    case 'cancelled':
      return 'Sign in was cancelled.'
    case 'rejected':
      return 'Something went wrong. Try again.'
    case 'full':
      return 'This party is full.'
  }
}
