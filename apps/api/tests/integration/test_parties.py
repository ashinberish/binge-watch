"""Watch parties over HTTP: create, read, join, leave, expiry."""

import uuid
from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.time import utcnow
from app.modules.parties.hub import InMemoryPartyHub
from app.modules.parties.models import Party
from app.modules.parties.service import CODE_ALPHABET
from app.workers.tasks import end_expired_parties_async
from tests.conftest import register_and_login

WATCH_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


async def create_party(
    client: httpx.AsyncClient, headers: dict[str, str], **overrides: Any
) -> dict[str, Any]:
    body = {"provider": "youtube", "watch_url": WATCH_URL} | overrides
    resp = await client.post("/api/v1/parties", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    data: dict[str, Any] = resp.json()
    return data


async def expire(session: AsyncSession, code: str) -> None:
    await session.execute(
        update(Party).where(Party.code == code).values(expires_at=utcnow() - timedelta(seconds=1))
    )
    await session.commit()


async def test_create_party(
    client: httpx.AsyncClient, auth: dict[str, Any], settings: Settings
) -> None:
    before = utcnow()
    party = await create_party(client, auth["headers"])

    assert set(party) == {
        "id",
        "code",
        "invite_url",
        "provider",
        "watch_url",
        "episode_id",
        "host",
        "member_count",
        "expires_at",
        "created_at",
    }
    code = party["code"]
    assert len(code) == 10
    assert set(code) <= set(CODE_ALPHABET)
    assert party["invite_url"] == f"{settings.web_url}/party/{code}"
    assert party["provider"] == "youtube"
    assert party["watch_url"] == WATCH_URL
    assert party["episode_id"] is None
    assert party["host"] == {"id": auth["user"]["id"], "display_name": "Binger"}
    assert party["member_count"] == 1  # the creator is a member
    lifetime = datetime.fromisoformat(party["expires_at"]) - before
    assert timedelta(hours=12) - timedelta(minutes=1) < lifetime <= timedelta(hours=12, seconds=5)


async def test_create_party_with_episode(
    client: httpx.AsyncClient, auth_headers: dict[str, str], episode_ids: list[uuid.UUID]
) -> None:
    party = await create_party(client, auth_headers, episode_id=str(episode_ids[0]))
    assert party["episode_id"] == str(episode_ids[0])


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"watch_url": "http://www.youtube.com/watch?v=x"}, "watch_url"),
        ({"watch_url": "https://evil.example/watch?v=x"}, "watch_url"),
        ({"watch_url": "https://youtube.com.evil.example/x"}, "watch_url"),
        ({"watch_url": "https://user:pw@www.youtube.com/watch?v=x"}, "watch_url"),
        ({"watch_url": "https://www.youtube.com:99999/x"}, "watch_url"),
        ({"watch_url": "not a url"}, "watch_url"),
        ({"watch_url": "https://www.youtube.com/" + "a" * 2048}, "watch_url"),
        ({"provider": "YouTube"}, "provider"),
        ({"provider": ""}, "provider"),
        ({"episode_id": str(uuid.UUID(int=1))}, "episode_id"),
    ],
)
async def test_create_party_validation(
    client: httpx.AsyncClient, auth_headers: dict[str, str], body: dict[str, Any], field: str
) -> None:
    payload = {"provider": "youtube", "watch_url": WATCH_URL} | body
    resp = await client.post("/api/v1/parties", json=payload, headers=auth_headers)
    assert resp.status_code == 422, resp.text
    assert resp.headers["content-type"] == "application/problem+json"
    problem = resp.json()
    assert problem["status"] == 422
    assert [err["loc"] for err in problem["errors"]] == [["body", field]]


async def test_allowed_hosts_are_configurable(
    client: httpx.AsyncClient, app: FastAPI, auth_headers: dict[str, str], settings: Settings
) -> None:
    app.state.settings = settings.model_copy(
        update={"party_allowed_hosts": ["www.youtube.com", "Vimeo.com"]}
    )
    party = await create_party(client, auth_headers, watch_url="https://vimeo.com/123")
    assert party["watch_url"] == "https://vimeo.com/123"


async def test_get_party(
    client: httpx.AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any]
) -> None:
    party = await create_party(client, auth["headers"])

    # Any signed-in user with the code can read it, codes are case-insensitive.
    resp = await client.get(
        f"/api/v1/parties/{party['code'].upper()}", headers=other_auth["headers"]
    )
    assert resp.status_code == 200
    assert resp.json() == party

    resp = await client.get("/api/v1/parties/nosuchcode", headers=auth["headers"])
    assert resp.status_code == 404
    assert resp.headers["content-type"] == "application/problem+json"
    resp = await client.get(f"/api/v1/parties/{'x' * 40}", headers=auth["headers"])
    assert resp.status_code == 404


async def test_join_is_idempotent(
    client: httpx.AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any]
) -> None:
    party = await create_party(client, auth["headers"])
    url = f"/api/v1/parties/{party['code']}/join"

    for _ in range(2):
        resp = await client.post(url, headers=other_auth["headers"])
        assert resp.status_code == 200, resp.text
        assert resp.json()["member_count"] == 2
        assert resp.json()["host"]["id"] == auth["user"]["id"]

    # The host joining their own party changes nothing.
    resp = await client.post(url, headers=auth["headers"])
    assert resp.json()["member_count"] == 2


async def test_join_full_party_conflicts(
    client: httpx.AsyncClient,
    app: FastAPI,
    settings: Settings,
    auth: dict[str, Any],
    other_auth: dict[str, Any],
) -> None:
    app.state.settings = settings.model_copy(update={"party_max_members": 2})
    party = await create_party(client, auth["headers"])
    url = f"/api/v1/parties/{party['code']}/join"
    assert (await client.post(url, headers=other_auth["headers"])).status_code == 200

    third = await register_and_login(client, "third@example.com", "Third")
    resp = await client.post(url, headers=third["headers"])
    assert resp.status_code == 409
    assert resp.headers["content-type"] == "application/problem+json"
    assert resp.json()["detail"] == "This party is full."

    # Existing members can still "join" (idempotent) when the room is full.
    assert (await client.post(url, headers=other_auth["headers"])).status_code == 200


async def test_leave_and_end(
    client: httpx.AsyncClient, app: FastAPI, auth: dict[str, Any], other_auth: dict[str, Any]
) -> None:
    party = await create_party(client, auth["headers"])
    code = party["code"]
    await client.post(f"/api/v1/parties/{code}/join", headers=other_auth["headers"])

    hub: InMemoryPartyHub = app.state.party_hub
    async with hub.subscribe(code) as sub:
        # The host leaves while a member remains: the party carries on.
        resp = await client.post(f"/api/v1/parties/{code}/leave", headers=auth["headers"])
        assert resp.status_code == 204
        assert resp.content == b""
        resp = await client.get(f"/api/v1/parties/{code}", headers=auth["headers"])
        assert resp.status_code == 200
        assert resp.json()["member_count"] == 1
        # Leaving twice is fine.
        resp = await client.post(f"/api/v1/parties/{code}/leave", headers=auth["headers"])
        assert resp.status_code == 204

        # The last member leaves: the party ends and sockets are told.
        resp = await client.post(f"/api/v1/parties/{code}/leave", headers=other_auth["headers"])
        assert resp.status_code == 204
        assert await sub.get() == {"type": "ended"}

    for method, path in [
        ("GET", f"/api/v1/parties/{code}"),
        ("POST", f"/api/v1/parties/{code}/join"),
        ("POST", f"/api/v1/parties/{code}/leave"),
    ]:
        resp = await client.request(method, path, headers=other_auth["headers"])
        assert resp.status_code == 404, (method, path)


async def test_expired_party_is_gone(
    client: httpx.AsyncClient,
    session: AsyncSession,
    auth: dict[str, Any],
    other_auth: dict[str, Any],
) -> None:
    party = await create_party(client, auth["headers"])
    code = party["code"]
    await expire(session, code)

    assert (await client.get(f"/api/v1/parties/{code}", headers=auth["headers"])).status_code == 404
    resp = await client.post(f"/api/v1/parties/{code}/join", headers=other_auth["headers"])
    assert resp.status_code == 404
    resp = await client.post(f"/api/v1/parties/{code}/leave", headers=auth["headers"])
    assert resp.status_code == 404


async def test_end_expired_parties_task(
    client: httpx.AsyncClient, session: AsyncSession, auth: dict[str, Any], settings: Settings
) -> None:
    live = await create_party(client, auth["headers"])
    stale = await create_party(client, auth["headers"])
    await expire(session, stale["code"])

    hub = InMemoryPartyHub(ttl_seconds=60)
    async with hub.subscribe(stale["code"]) as sub:
        assert await end_expired_parties_async(settings, hub=hub) == 1
        assert await sub.get() == {"type": "ended"}
    assert await end_expired_parties_async(settings, hub=hub) == 0

    session.expire_all()
    rows = {p.code: p.ended_at for p in (await session.execute(select(Party))).scalars().all()}
    assert rows[live["code"]] is None
    assert rows[stale["code"]] is not None


async def test_end_expired_parties_task_builds_its_own_hub(
    settings: Settings, app: FastAPI
) -> None:
    # Uses APP_PARTY_HUB from settings (memory here) and closes it afterwards.
    assert await end_expired_parties_async(settings) == 0


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/v1/parties"),
        ("GET", "/api/v1/parties/abc"),
        ("POST", "/api/v1/parties/abc/join"),
        ("POST", "/api/v1/parties/abc/leave"),
    ],
)
async def test_parties_require_auth(client: httpx.AsyncClient, method: str, path: str) -> None:
    resp = await client.request(method, path, json={"provider": "youtube", "watch_url": WATCH_URL})
    assert resp.status_code == 401
    assert resp.headers["content-type"] == "application/problem+json"
