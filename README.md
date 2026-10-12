# Binge Watch (Nightreel)

A binge-watching companion: a **web app** for managing your account (profiles, watch
history, settings and, later, your plan) and a **Chrome extension** that adds continue
watching, next-episode countdowns and binge streaks to streaming players.

## Layout

```
apps/
  api/          FastAPI service — Python 3.13, uv, SQLAlchemy 2 async, Alembic, Celery
  web/          React 19 + Vite — TanStack Router + Query
  extension/    Chrome extension — Manifest V3, WXT, React
packages/
  ui/           Nightreel tokens + reusable primitives (Storybook), shared by web and extension
  api-client/   TypeScript client generated from the API's OpenAPI schema
  shared/       Shared types and formatters ("S2 · E5", "18 min left")
  config/       tsconfig and ESLint presets
infra/          Docker, Helm, Terraform
docs/adr/       Architecture decision records
```

## Getting started

Requirements: Node 22, pnpm 10, Python 3.13, uv, Docker.

```sh
make setup     # install JS and Python dependencies
make up        # start Postgres and Redis
make migrate   # create the schema
make dev       # API on :8000, web on :5173, extension in watch mode
```

Load the extension in Chrome from `apps/extension/.output/chrome-mv3` (Developer mode → Load unpacked).

| Command          | Does                                             |
| ---------------- | ------------------------------------------------ |
| `make lint`      | ESLint + ruff                                    |
| `make typecheck` | tsc + mypy                                       |
| `make test`      | Vitest + pytest                                  |
| `make gen`       | Regenerate the TS API client after an API change |
| `make storybook` | Browse the UI primitives                         |

## Build order

0. Foundation: monorepo, tooling, CI, local infra
1. Backend core: auth, users, profiles, catalog, history, streaks
2. Web app: sign in, profile picker, watch history, settings
3. Chrome extension: popup sign-in, player adapters, progress sync, countdown overlay
4. Hardening: tracing, rate limits, Helm/Terraform, Web Store release pipeline
5. Pricing and billing (last)

See `docs/adr/` for the decisions behind this layout.
