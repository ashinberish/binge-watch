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
    auth users profiles catalog watch_history streaks billing
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

## Background worker

```bash
uv run celery -A app.workers.celery_app worker -l info
```

## Configuration

All settings are environment variables prefixed with `APP_`; see `.env.example` and
`src/app/core/config.py`. In `APP_ENVIRONMENT=production` the default JWT secret is rejected.
