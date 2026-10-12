# nightreel-api

Backend for **Nightreel**, the binge-watching companion (web account manager + Chrome
extension). FastAPI · SQLAlchemy 2 (async) · PostgreSQL · Alembic · Celery/Redis · Python 3.13 · uv.

## Quick start

From the repo root:

```bash
make setup     # installs JS deps and runs `uv sync` here
make up        # postgres + redis via docker compose
make migrate   # alembic upgrade head
make api       # uvicorn with reload on :8000
```

Or directly in `apps/api`:

```bash
cp .env.example .env
uv sync
uv run alembic upgrade head
uv run python -m app.scripts.seed        # 3 demo shows
uv run uvicorn app.main:app --reload
```

Docs: <http://localhost:8000/docs> · probes: `/health/live`, `/health/ready`.

## Quality gates

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run pytest            # SQLite (aiosqlite) temp DB per test, coverage report
```

## OpenAPI → TypeScript client

The web app and extension consume a generated client in `packages/api-client`.

```bash
uv run python -m app.scripts.export_openapi ../../packages/api-client/openapi.json
# or from the root: make gen
```

### Endpoints (`/api/v1`)

| Area | Endpoints |
| --- | --- |
| auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/extension-code` (bearer), `/auth/extension-token` |
| users | `GET`/`PATCH /users/me` |
| profiles | `GET`/`POST /profiles`, `PATCH`/`DELETE /profiles/{id}` |
| catalog | `GET /catalog/shows`, `/catalog/shows/{id}`, `/catalog/episodes/{id}/next`, `POST /catalog/match` |
| watch_history | `PUT /history/{episode_id}/progress`, `GET /history/continue-watching` |
| streaks | `GET /streaks/current` |
| parties | `POST /parties`, `GET /parties/{code}`, `POST /parties/{code}/join`, `/parties/{code}/leave`, WebSocket `/parties/{code}/ws` |

Every route has an explicit `operationId` (`<module>_<action>`), so regenerated client
method names stay stable. Error responses are documented as `application/problem+json`.

## Layout

```
src/app/
  main.py              create_app() factory, middleware, routers, exception handlers
  core/                config (APP_* settings), security (argon2, JWT), logging (structlog),
                       exceptions (RFC 9457 problem details), telemetry hooks, time
  db/                  declarative base + mixins, UTC datetime type, engine/session, repo base,
                       models.py (imports every model for Alembic/tests)
  api/                 deps (DbSession, CurrentUser, Pagination), health probes, v1 router
  middleware/          X-Request-ID correlation + access log
  modules/<domain>/    router.py → service.py → repository.py → models.py, schemas.py
    auth users profiles catalog watch_history streaks parties billing
  integrations/        tmdb.py (client interface, not wired yet)
  workers/             Celery app + tasks
  scripts/             export_openapi, seed
migrations/            Alembic (async env, hand-written 0001 baseline)
tests/                 unit/ and integration/
```

### Layering rules

- **Routers** translate HTTP ⇄ service calls only (status codes, response models).
- **Services** own business rules (profile limits, ownership, completion threshold,
  streak maths, token rotation) and the transaction boundary (`commit`).
- **Repositories** own SQLAlchemy queries. Services receive them through `Depends`.

### Domain rules worth knowing

- **Auth**: short-lived access JWT (15 min) + refresh JWT (30 days). Refresh tokens are
  stored as SHA-256 digests in `refresh_tokens`, rotated on every `/auth/refresh`; presenting
  an already-rotated token revokes all of that user's refresh tokens (reuse detection).
- **Extension sign-in**: the extension opens the web app at `/extension/connect` via
  `chrome.identity.launchWebAuthFlow`; the signed-in web app calls `POST /auth/extension-code`
  with the extension's `https://<id>.chromiumapp.org/...` redirect URI and redirects there with
  the code; the extension redeems it at `POST /auth/extension-token` for a normal token pair.
  Codes are 32 random bytes, stored as SHA-256 digests in `extension_codes`, valid 60 s, single
  use (claimed with one conditional `UPDATE`) and bound to their redirect URI. The Celery task
  `nightreel.purge_extension_codes` deletes codes older than a day (not scheduled yet).
- **Catalog matching**: `POST /catalog/match` turns what a streaming site is playing into a
  catalog episode: first a stored `(provider, external_id)` mapping (`episode_external_ids`),
  then the show by case-insensitive exact title + season/episode, and otherwise the missing
  show/season/episode is created on first sight (season defaults to 1, episode to the next
  number, title to `Episode N`, duration to 0). Concurrent first sightings collide on unique
  constraints and the loser re-reads. `GET /catalog/episodes/{id}/next` (also embedded in the
  match result) is the next episode in the season, else the first of the next season.
- **Profiles**: max 5 per account. Any profile-scoped endpoint returns 404 for a profile the
  caller doesn't own.
- **Watch progress**: position is clamped to duration; an episode is `completed` at ≥ 90 %.
- **Streaks**: a streak day is a UTC calendar day with ≥ 1 newly completed episode. The streak
  stays current through the following day and resets after a missed day.
- **Billing**: `modules/billing/entitlements.require_feature()` is a no-op gate today;
  pricing arrives in the final phase.

## Watch parties

Synced playback for several viewers. First version: play/pause/seek sync and a member count
(no chat, reactions or presence list). **Everyone** in the room can control playback; the
server orders controls and the last one wins.

### HTTP (`/api/v1`, bearer auth)

| Endpoint | |
| --- | --- |
| `POST /parties` → 201 `PartyRead` | Body `{provider, watch_url, episode_id?}`. `provider` matches `^[a-z0-9-]{1,32}$`; `watch_url` must be `https://` with a host in `APP_PARTY_ALLOWED_HOSTS` (default `www.youtube.com`), else 422. The creator hosts and is the first member. |
| `GET /parties/{code}` → `PartyRead` | Any signed-in user with the code. 404 if unknown, ended or expired. |
| `POST /parties/{code}/join` → `PartyRead` | Idempotent. 404 unknown/ended/expired, 409 when `APP_PARTY_MAX_MEMBERS` (20) is reached. |
| `POST /parties/{code}/leave` → 204 | Idempotent. When the last member leaves (host or not), the party ends and sockets get `ended`. |

`PartyRead = {id, code, invite_url, provider, watch_url, episode_id, host: {id, display_name},
member_count, expires_at, created_at}`; `invite_url` is `{APP_WEB_URL}/party/{code}`. Codes are
10 characters from `23456789abcdefghjkmnpqrstuvwxyz` (lookups are case-insensitive). Parties
expire `APP_PARTY_TTL_HOURS` (12) after creation; the Celery task
`nightreel.end_expired_parties` (beat: every 5 min) marks them ended in the database.

### WebSocket `GET /api/v1/parties/{code}/ws`

JSON text frames. No `Authorization` header (browsers and extension service workers can't
set one): authentication is the first message.

1. **Origin**: if an `Origin` header is present it must be in `APP_CORS_ORIGINS` or match
   `APP_CORS_ORIGIN_REGEX` (the Chrome extension); otherwise close `4403`. No Origin is allowed.
2. **Auth**: within 5 s send `{"type":"auth","access_token":"<access JWT>"}`. Missing,
   invalid, expired, non-auth first message or timeout → close `4401`.
3. Party unknown, ended or expired → close `4404`. Caller is not a member (call
   `POST /parties/{code}/join` first) → close `4403`.
4. Server sends
   `{"type":"welcome","state":PlaybackState,"members":int,"you":{"id","display_name"}}`.

`PlaybackState = {"paused":bool, "position":float, "rate":float, "updated_at":float,
"seq":int, "by":{"id","display_name"}|null}` — `position` in seconds at `updated_at` (server
epoch seconds). A fresh room is `{"paused":true,"position":0,"rate":1,"updated_at":0,"seq":0,"by":null}`.

Expected position at server time `now`: `position + (paused ? 0 : (now - updated_at) * rate)`.

| Client → server | Server behaviour |
| --- | --- |
| `{"type":"control","action":"play"\|"pause"\|"seek","position":float≥0,"rate"?:0.25–4}` | `play` → `paused=false`, `pause` → `paused=true`, `seek` keeps `paused`. `position` from the message, `rate` from the message or unchanged, `updated_at` = server now, `seq` + 1, `by` = sender. Broadcasts `{"type":"state","state":PlaybackState}` to **all** sockets, sender included (use `seq` to drop your own echo / stale states). Max 10 controls/s per socket (burst 10); excess silently dropped. |
| `{"type":"ping"}` (every ~20 s) | `{"type":"pong","server_time":float}` — use for clock offset. |
| anything malformed (bad JSON, unknown type, invalid fields, binary frame, > 8 KiB, a second `auth`) | `{"type":"error","detail":"..."}`; the socket stays open. |

| Server → client | |
| --- | --- |
| `{"type":"members","count":int}` | Distinct users currently connected (a user's second tab doesn't count twice), sent on every connect/disconnect. |
| `{"type":"ended"}` then close `4410` | The party ended (last member left) or reached `expires_at`. |

Other close codes: `4408` no message for 60 s (keep pinging), `1012` server shutting down
(reconnect), `1011` internal error.

**Scale-out.** The handler only talks to a `PartyHub` (`modules/parties/hub.py`).
`RedisPartyHub` (`APP_PARTY_HUB=redis`, default) keeps state and connected-member counts in
Redis hashes (`nightreel:party:{code}:state|members`, TTL = party TTL) and mutates them with
Lua scripts that also `PUBLISH` the resulting event on `nightreel:party:{code}:events`, so
`seq` order equals broadcast order across processes; each API process uses one pub/sub
connection and fans out locally. `InMemoryPartyHub` (`APP_PARTY_HUB=memory`) is for tests and
single-process dev. The hub is created in `create_app` and closed in the lifespan, which
closes open party sockets with `1012`. Hub tests run against memory and `fakeredis`; set
`APP_TEST_REDIS_URL=redis://localhost:6379/15` to also run them against a real Redis
(the test flushes that DB).

## Background worker

```bash
uv run celery -A app.workers.celery_app worker -l info
uv run celery -A app.workers.celery_app beat -l info    # schedules nightreel.end_expired_parties
```

## Configuration

All settings are environment variables prefixed with `APP_`; see `.env.example` and
`src/app/core/config.py`. In `APP_ENVIRONMENT=production` the default JWT secret is rejected.
