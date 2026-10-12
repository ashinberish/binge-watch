# 1. One monorepo for API, web app and extension

- Status: accepted
- Date: 2026-10-12

## Context

Nightreel ships three surfaces (a FastAPI service, a React web app, a Chrome extension) that
share an API contract and a design language. Keeping them in separate repos would mean
publishing the client and the UI kit as packages and keeping versions in step by hand.

## Decision

- One repo. pnpm workspaces + Turborepo for TypeScript, uv for Python.
- `apps/*` are deployables; `packages/*` are shared libraries and never deploy alone.
- The API contract is generated: FastAPI → `openapi.json` → `packages/api-client`. CI fails on drift.
- UI primitives live in `packages/ui` and are shared by the web app and the extension.
- Code is organised by domain (feature folders), not by technical layer.
- Pricing and billing are built last; a `billing` module and an always-allow
  `require_feature()` check exist from the start so they slot in without a refactor.

## Consequences

- CI is path-filtered per app so a change only runs the checks it can affect.
- A breaking API change shows up as a type error in the web app and the extension in the same PR.
