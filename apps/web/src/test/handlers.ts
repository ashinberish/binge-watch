import { http, HttpResponse } from 'msw'
import { API, continueWatching, problem, profiles, streak, tokenPair, user } from './fixtures'

const problemJson = (status: number, title: string, detail?: string) =>
  HttpResponse.json(problem(status, title, detail), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  })

const authed = (request: Request) => request.headers.get('Authorization')?.startsWith('Bearer ')

/** Happy-path handlers for the API contract. Override per test with server.use(). */
export const handlers = [
  http.post(`${API}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string }
    if (body.password !== 'correct-horse') {
      return problemJson(401, 'Unauthorized', 'Wrong email or password.')
    }
    return HttpResponse.json(tokenPair)
  }),
  http.post(`${API}/auth/register`, async ({ request }) => {
    const body = (await request.json()) as { email: string; display_name: string }
    if (body.email === 'taken@example.com') {
      return problemJson(409, 'Conflict', 'An account with this email already exists.')
    }
    return HttpResponse.json(
      { ...user, email: body.email, display_name: body.display_name },
      { status: 201 },
    )
  }),
  http.post(`${API}/auth/refresh`, () =>
    HttpResponse.json({ ...tokenPair, access_token: 'access-2' }),
  ),
  http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
  http.get(`${API}/users/me`, ({ request }) =>
    authed(request) ? HttpResponse.json(user) : problemJson(401, 'Unauthorized'),
  ),
  http.patch(`${API}/users/me`, async ({ request }) => {
    const body = (await request.json()) as { display_name?: string }
    return HttpResponse.json({ ...user, ...body })
  }),
  http.get(`${API}/profiles`, () => HttpResponse.json(profiles)),
  http.post(`${API}/profiles`, async ({ request }) => {
    const body = (await request.json()) as {
      name: string
      avatar_color?: string
      is_kids?: boolean
    }
    return HttpResponse.json(
      {
        id: 'p_new',
        avatar_color: '#f5b841',
        is_kids: false,
        created_at: '2026-10-12T00:00:00Z',
        ...body,
      },
      { status: 201 },
    )
  }),
  http.get(`${API}/history/continue-watching`, () => HttpResponse.json(continueWatching)),
  http.get(`${API}/streaks/current`, () => HttpResponse.json(streak)),
  http.post(`${API}/auth/extension-code`, ({ request }) =>
    authed(request)
      ? HttpResponse.json({ code: 'code-1', expires_in: 60 }, { status: 201 })
      : problemJson(401, 'Unauthorized'),
  ),
]
