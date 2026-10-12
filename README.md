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

Works the same on **Windows, macOS and Linux**: every command is a root `package.json` script.

### 1. Install prerequisites

| Tool                      | Windows (PowerShell)                                                                  | macOS                        |
| ------------------------- | ------------------------------------------------------------------------------------- | ---------------------------- |
| Node 22+                  | `winget install OpenJS.NodeJS.LTS`                                                    | `brew install node@22`       |
| pnpm 10                   | `corepack enable pnpm`                                                                | `corepack enable pnpm`       |
| uv (installs Python 3.13) | `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 \| iex"` | `brew install uv`            |
| Docker                    | `winget install Docker.DockerDesktop` (WSL 2 backend)                                 | `brew install --cask docker` |

On Linux, use your package manager for Node and Docker, and `curl -LsSf https://astral.sh/uv/install.sh | sh` for uv.

### 2. Set up and run

```sh
pnpm bootstrap      # checks prerequisites, creates .env files, installs JS + Python deps
pnpm services:up    # start Postgres and Redis in Docker
pnpm migrate        # create the schema
pnpm seed           # optional: three demo shows
pnpm dev            # API on :8000, web on :5173, extension in watch mode
```

Load the extension in Chrome from `apps/extension/.output/chrome-mv3-dev` (chrome://extensions → Developer mode → Load unpacked).

| Command              | Does                                                         |
| -------------------- | ------------------------------------------------------------ |
| `pnpm check`         | Format check, lint, typecheck and tests for everything       |
| `pnpm lint`          | ESLint + ruff                                                |
| `pnpm typecheck`     | tsc + mypy                                                   |
| `pnpm test`          | Vitest + pytest                                              |
| `pnpm gen`           | Regenerate the TS API client after an API change             |
| `pnpm storybook`     | Browse the UI primitives                                     |
| `pnpm worker`        | Celery worker (runs with `--pool=solo`, which Windows needs) |
| `pnpm services:down` | Stop Postgres and Redis                                      |

On macOS and Linux, `make setup`, `make dev`, `make check` and so on are shortcuts for the same scripts.

**Windows notes**

- Run `pnpm bootstrap` and `pnpm services:up`, not `pnpm setup` or `pnpm up`. Those two names are built-in pnpm commands.
- `.gitattributes` keeps LF line endings, so formatters and Docker builds behave the same as on macOS and Linux.
- Use PowerShell 7 or Windows Terminal; no WSL is needed for development itself (Docker Desktop uses it under the hood).

## Build order

0. Foundation: monorepo, tooling, CI, local infra
1. Backend core: auth, users, profiles, catalog, history, streaks
2. Web app: sign in, profile picker, watch history, settings
3. Chrome extension: popup sign-in, player adapters, progress sync, countdown overlay
4. Hardening: tracing, rate limits, Helm/Terraform, Web Store release pipeline
5. Pricing and billing (last)

See `docs/adr/` for the decisions behind this layout.
