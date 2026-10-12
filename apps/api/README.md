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

Synced playback for several viewers, with a live member list (presence), chat and emoji
reactions. **Everyone** in the room can control playback; the server orders controls and the
last one wins.

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
   `{"type":"welcome","state":PlaybackState,"members":int,"you":{"id","display_name"},
   "members_list":[Member],"chat":[ChatMessage]}` (`chat` is the room's last ≤ 50 messages,
   oldest first).

`PlaybackState = {"paused":bool, "position":float, "rate":float, "updated_at":float,
"seq":int, "by":{"id","display_name"}|null}` — `position` in seconds at `updated_at` (server
epoch seconds). A fresh room is `{"paused":true,"position":0,"rate":1,"updated_at":0,"seq":0,"by":null}`.

Expected position at server time `now`: `position + (paused ? 0 : (now - updated_at) * rate)`.

`Member = {"id", "display_name", "is_host":bool, "status":"watching"|"buffering"|"ad"|"away",
"joined_at":float}` — `joined_at` is the server epoch of the user's first connection to this
party (kept across reconnects). Lists are sorted host first, then by `joined_at`. A user with
several sockets is listed once; their status is the last one any of their sockets sent. A
user's status starts as `watching` when they go from no sockets to one.

`ChatMessage = {"id":str, "user":{"id","display_name"}, "text":str, "sent_at":float}` (`id`
is 32 hex characters; `sent_at` server epoch seconds).

| Client → server | Server behaviour |
| --- | --- |
| `{"type":"control","action":"play"\|"pause"\|"seek","position":float≥0,"rate"?:0.25–4}` | `play` → `paused=false`, `pause` → `paused=true`, `seek` keeps `paused`. `position` from the message, `rate` from the message or unchanged, `updated_at` = server now, `seq` + 1, `by` = sender. Broadcasts `{"type":"state","state":PlaybackState}` to **all** sockets, sender included (use `seq` to drop your own echo / stale states). Max 10 controls/s per socket (burst 10); excess silently dropped. |
| `{"type":"ping"}` (every ~20 s) | `{"type":"pong","server_time":float}` — use for clock offset. |
| `{"type":"status","status":"watching"\|"buffering"\|"ad"\|"away"}` | Sets the sender's status (per user, not per socket); a `presence` frame follows if it changed. |
| `{"type":"chat","text":str}` | Text is cleaned (whitespace runs incl. newlines → one space, control and bidi-override characters removed, trimmed) and must then be 1–500 characters, else `error`. Max 5 messages per 5 s per user (all their sockets); excess → `{"type":"error","detail":"You're sending messages too quickly."}`. Broadcasts `{"type":"chat","message":ChatMessage}` to all sockets, sender included. |
| `{"type":"react","kind":"heart"\|"laugh"\|"wow"\|"fire"\|"clap"\|"sad"}` | Broadcasts `{"type":"reaction","id":str,"kind","user":{"id","display_name"},"at":float}` to all sockets, sender included. Not stored. Max 3 per second per user; excess silently dropped. |
| anything malformed (bad JSON, unknown type, invalid fields, binary frame, > 8 KiB, a second `auth`) | `{"type":"error","detail":"..."}`; the socket stays open. |

| Server → client | |
| --- | --- |
| `{"type":"members","count":int}` | Distinct users currently connected (a user's second tab doesn't count twice), sent on every connect/disconnect. |
| `{"type":"presence","members":[Member]}` | The full member list, whenever someone joins, leaves or changes status. Changes within ~100 ms are coalesced into one frame, and an identical list may be re-sent; always replace your list with the latest frame. |
| `{"type":"chat","message":ChatMessage}` | A new chat message. |
| `{"type":"reaction",...}` | See `react` above. |
| `{"type":"ended"}` then close `4410` | The party ended (last member left) or reached `expires_at`. |

Other close codes: `4408` no message for 60 s (keep pinging), `1012` server shutting down
(reconnect), `1011` internal error.

Control rate limits are per socket; chat and reaction limits are per user and kept in the hub,
so they hold across tabs and API processes.

**Chat is ephemeral by design.** Messages live only in the hub (the last 50 per party) and
disappear when the party ends or its TTL runs out. They are never written to Postgres.

**Scale-out.** The handler only talks to a `PartyHub` (`modules/parties/hub.py`).
`RedisPartyHub` (`APP_PARTY_HUB=redis`, default) keeps the party's realtime data under
`nightreel:party:{code}:…` (TTL = party TTL): `state` (hash), `members` (hash
`{user_id}|{proc_id}` → open sockets), `presence` / `status` / `joined` (hashes keyed by user
id), `chat` (list, newest first, `LTRIM`med to 50) and short-lived per-user `rate:chat|react:{user_id}`
lists. Every mutation is a Lua script that also `PUBLISH`es the resulting event on
`nightreel:party:{code}:events`, so `seq` order equals broadcast order across processes and a
chat message is stored and broadcast in one step. Each API process uses one pub/sub
connection and fans out locally. Presence changes are published as an internal
`presence_changed` signal; each process then re-reads the list (coalescing signals for
~100 ms) and sends `presence` frames to its own sockets.

**Crash recovery.** Each API process has an id and keeps `nightreel:party:proc:{proc_id}`
alive (refreshed every 15 s, TTL 45 s; deleted on graceful shutdown). Connections are stored
with the id of the process holding them. Counts and member lists skip connections whose
process key has expired. The next connect or disconnect in that party, or the 15 s heartbeat
sweep of any process with sockets in it, deletes those connections and re-broadcasts
`members` and `presence`. So viewers of a crashed process disappear within about a minute
instead of staying until the party TTL. `InMemoryPartyHub` (`APP_PARTY_HUB=memory`) is for tests and
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
