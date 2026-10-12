.PHONY: setup dev up down api web extension storybook lint typecheck test gen migrate

setup: ## Install all dependencies
	[ -f .env ] || cp .env.example .env
	pnpm install
	cd apps/api && uv sync

up: ## Start Postgres and Redis
	docker compose up -d postgres redis

down:
	docker compose down

migrate: ## Apply database migrations
	cd apps/api && uv run alembic upgrade head

api: ## Run the API with reload
	cd apps/api && uv run uvicorn app.main:app --reload --port 8000

web:
	pnpm --filter @nightreel/web dev

extension:
	pnpm --filter @nightreel/extension dev

storybook:
	pnpm --filter @nightreel/ui storybook

dev: up ## Infra in docker, apps with hot reload
	$(MAKE) -j3 api web extension

lint:
	pnpm lint
	cd apps/api && uv run ruff check . && uv run ruff format --check .

typecheck:
	pnpm typecheck
	cd apps/api && uv run mypy src

test:
	pnpm test
	cd apps/api && uv run pytest

gen: ## Regenerate the TS API client from the FastAPI OpenAPI schema
	cd apps/api && uv run python -m app.scripts.export_openapi ../../packages/api-client/openapi.json
	pnpm gen:api
