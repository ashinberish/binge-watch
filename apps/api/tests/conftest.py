"""Shared fixtures: an isolated app per test backed by a temp-file SQLite database."""

import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.models import Base
from app.main import create_app
from app.modules.catalog.models import Show
from app.modules.catalog.repository import CatalogRepository
from app.scripts.seed import seed

PASSWORD = "correct-horse-battery"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        environment="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        jwt_secret=SecretStr("test-secret-that-is-long-enough-for-hs256"),
        argon2_time_cost=1,
        argon2_memory_cost=8,
        argon2_parallelism=1,
        log_json=False,
        log_level="WARNING",
        cors_origins=["http://localhost:5173"],
        cors_origin_regex="chrome-extension://[a-p]{32}",
        web_url="http://localhost:5173",
        party_hub="memory",
    )


@pytest.fixture
async def app(settings: Settings) -> AsyncIterator[FastAPI]:
    application = create_app(settings)
    async with application.state.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield application
    await application.state.engine.dispose()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def session(app: FastAPI) -> AsyncIterator[AsyncSession]:
    async with app.state.sessionmaker() as db:
        yield db


async def register_and_login(
    client: httpx.AsyncClient, email: str, display_name: str = "Binger"
) -> dict[str, Any]:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": PASSWORD, "display_name": display_name},
    )
    assert resp.status_code == 201, resp.text
    user = resp.json()
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    tokens = resp.json()
    return {
        "user": user,
        "tokens": tokens,
        "headers": {"Authorization": f"Bearer {tokens['access_token']}"},
    }


@pytest.fixture
async def auth(client: httpx.AsyncClient) -> dict[str, Any]:
    return await register_and_login(client, "viewer@example.com")


@pytest.fixture
def auth_headers(auth: dict[str, Any]) -> dict[str, str]:
    headers: dict[str, str] = auth["headers"]
    return headers


@pytest.fixture
async def other_auth(client: httpx.AsyncClient) -> dict[str, Any]:
    return await register_and_login(client, "someone-else@example.com", "Other")


@pytest.fixture
async def profile(client: httpx.AsyncClient, auth_headers: dict[str, str]) -> dict[str, Any]:
    resp = await client.post("/api/v1/profiles", json={"name": "Main"}, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    data: dict[str, Any] = resp.json()
    return data


@pytest.fixture
async def shows(session: AsyncSession) -> list[Show]:
    await seed(session)
    repo = CatalogRepository(session)
    listed = await repo.list_shows(query=None, limit=10, offset=0)
    detailed: list[Show] = []
    for show in listed:
        loaded = await repo.get_show_with_episodes(show.id)
        assert loaded is not None
        detailed.append(loaded)
    return detailed


@pytest.fixture
def episode_ids(shows: list[Show]) -> list[uuid.UUID]:
    """All episode ids of the first show, in watch order."""
    return [ep.id for season in shows[0].seasons for ep in season.episodes]
