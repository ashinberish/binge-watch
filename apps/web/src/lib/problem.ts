/** RFC 9457 problem details as returned by the API. 422s add `errors`. */
export interface Problem {
  type?: string
  title?: string
  status?: number
  detail?: string
  instance?: string
  errors?: Array<{ loc?: Array<string | number>; msg: string; type?: string }>
}

export class ApiError extends Error {
  readonly status: number
  readonly problem: Problem

  constructor(status: number, problem: Problem) {
    super(problem.detail ?? problem.title ?? `Request failed (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.problem = problem
  }

  /** Field errors from a 422, keyed by the last `loc` segment (e.g. "email"). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const e of this.problem.errors ?? []) {
      const key = e.loc?.[e.loc.length - 1]
      if (key != null && !(String(key) in out)) out[String(key)] = e.msg
    }
    return out
  }
}

function toProblem(error: unknown, status: number): Problem {
  if (error && typeof error === 'object') return error as Problem
  if (typeof error === 'string' && error) return { title: error, status }
  return { status }
}

/** Unwraps an openapi-fetch result: returns `data` or throws an ApiError. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (!result.response.ok || result.error !== undefined) {
    throw new ApiError(result.response.status, toProblem(result.error, result.response.status))
  }
  return result.data as T
}

/** Viewer-facing message for any thrown error. Never shows raw technical detail. */
export function errorMessage(
  error: unknown,
  fallback = 'Something went wrong. Try again.',
): string {
  if (error instanceof ApiError) {
    if (error.status >= 500) return 'Nightreel is having trouble right now. Try again in a moment.'
    return error.problem.detail ?? error.problem.title ?? fallback
  }
  if (error instanceof TypeError) return 'Cannot reach Nightreel. Check your connection.'
  return fallback
}
