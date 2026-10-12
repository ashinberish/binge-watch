import createClient, { type Middleware } from 'openapi-fetch'

import type { components, paths } from './schema'

export type { components, paths }
export type Schemas = components['schemas']

export interface ApiClientOptions {
  baseUrl: string
  /** Returns the current access token, or null when signed out. */
  getAccessToken?: () => string | null
  /**
   * Called once when a request comes back 401. Resolve `true` after refreshing
   * the session to retry the request with the new token.
   */
  onUnauthorized?: () => Promise<boolean>
}

const RETRIED = 'x-nightreel-retried'

export function createApiClient({ baseUrl, getAccessToken, onUnauthorized }: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl })

  // Unsent copies of in-flight requests, so a 401 can be retried with its body intact.
  const pending = new Map<string, Request>()

  const auth: Middleware = {
    onRequest({ id, request }) {
      const token = getAccessToken?.()
      if (token) request.headers.set('Authorization', `Bearer ${token}`)
      if (onUnauthorized) pending.set(id, request.clone())
      return request
    },
    async onResponse({ id, request, response }) {
      const copy = pending.get(id)
      pending.delete(id)
      if (response.status !== 401 || !copy || !onUnauthorized || request.headers.has(RETRIED)) {
        return response
      }
      if (!(await onUnauthorized())) return response
      const retry = copy
      retry.headers.set(RETRIED, '1')
      const token = getAccessToken?.()
      if (token) retry.headers.set('Authorization', `Bearer ${token}`)
      return fetch(retry)
    },
    onError({ id }) {
      pending.delete(id)
    },
  }

  client.use(auth)
  return client
}

export type ApiClient = ReturnType<typeof createApiClient>

/** RFC 9457 problem details, as every API error is shaped. */
export interface ProblemDetails {
  type: string
  title: string
  status: number
  detail?: string
}
