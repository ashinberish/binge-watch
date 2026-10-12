import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.catalog.models import Episode, Season, Show


def progress_url(episode_id: uuid.UUID) -> str:
    return f"/api/v1/history/{episode_id}/progress"


async def test_update_progress(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    profile: dict[str, Any],
    episode_ids: list[uuid.UUID],
) -> None:
    resp = await client.put(
        progress_url(episode_ids[0]),
        params={"profile_id": profile["id"]},
        json={"position_seconds": 120, "duration_seconds": 3000},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {
        "episode_id",
        "profile_id",
        "position_seconds",
        "duration_seconds",
        "completed",
        "updated_at",
    }
    assert body["episode_id"] == str(episode_ids[0])
    assert body["profile_id"] == profile["id"]
    assert body["position_seconds"] == 120
    assert body["completed"] is False

    # Same episode again updates in place; 90% marks it completed.
    resp = await client.put(
        progress_url(episode_ids[0]),
        params={"profile_id": profile["id"]},
        json={"position_seconds": 2700, "duration_seconds": 3000},
        headers=auth_headers,
    )
    assert resp.json()["completed"] is True


async def test_position_is_clamped_to_duration(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    profile: dict[str, Any],
    episode_ids: list[uuid.UUID],
) -> None:
    resp = await client.put(
        progress_url(episode_ids[0]),
        params={"profile_id": profile["id"]},
        json={"position_seconds": 5000, "duration_seconds": 3000},
        headers=auth_headers,
    )
    assert resp.json()["position_seconds"] == 3000
    assert resp.json()["completed"] is True


async def test_update_progress_validation(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    profile: dict[str, Any],
    episode_ids: list[uuid.UUID],
) -> None:
    for payload in (
        {"position_seconds": -1, "duration_seconds": 100},
        {"position_seconds": 1, "duration_seconds": 0},
    ):
        resp = await client.put(
            progress_url(episode_ids[0]),
            params={"profile_id": profile["id"]},
            json=payload,
            headers=auth_headers,
        )
        assert resp.status_code == 422
    resp = await client.put(
        progress_url(episode_ids[0]),
        json={"position_seconds": 1, "duration_seconds": 10},
        headers=auth_headers,
    )
    assert resp.status_code == 422  # missing profile_id


async def test_update_progress_unknown_episode(
    client: httpx.AsyncClient, auth_headers: dict[str, str], profile: dict[str, Any]
) -> None:
    resp = await client.put(
        progress_url(uuid.uuid4()),
        params={"profile_id": profile["id"]},
        json={"position_seconds": 1, "duration_seconds": 10},
        headers=auth_headers,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Episode not found."


async def test_profile_scoped_endpoints_hide_foreign_profiles(
    client: httpx.AsyncClient,
    profile: dict[str, Any],
    other_auth: dict[str, Any],
    episode_ids: list[uuid.UUID],
) -> None:
    headers = other_auth["headers"]
    params = {"profile_id": profile["id"]}
    resp = await client.put(
        progress_url(episode_ids[0]),
        params=params,
        json={"position_seconds": 1, "duration_seconds": 10},
        headers=headers,
    )
    assert resp.status_code == 404
    resp = await client.get("/api/v1/history/continue-watching", params=params, headers=headers)
    assert resp.status_code == 404
    resp = await client.get("/api/v1/streaks/current", params=params, headers=headers)
    assert resp.status_code == 404


async def test_continue_watching(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    profile: dict[str, Any],
    shows: list[Show],
    episode_ids: list[uuid.UUID],
) -> None:
    params = {"profile_id": profile["id"]}
    resp = await client.get(
        "/api/v1/history/continue-watching", params=params, headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json() == []

    async def watch(episode_id: uuid.UUID, position: int) -> None:
        r = await client.put(
            progress_url(episode_id),
            params=params,
            json={"position_seconds": position, "duration_seconds": 1000},
            headers=auth_headers,
        )
        assert r.status_code == 200

    await watch(episode_ids[0], 100)
    await watch(episode_ids[1], 950)  # completed -> excluded
    await watch(episode_ids[2], 300)

    resp = await client.get(
        "/api/v1/history/continue-watching", params=params, headers=auth_headers
    )
    items = resp.json()
    assert [i["episode_id"] for i in items] == [str(episode_ids[2]), str(episode_ids[0])]
    first = items[0]
    assert set(first) == {
        "episode_id",
        "show_id",
        "show_title",
        "poster_url",
        "season_number",
        "episode_number",
        "episode_title",
        "position_seconds",
        "duration_seconds",
        "updated_at",
    }
    assert first["show_id"] == str(shows[0].id)
    assert first["show_title"] == shows[0].title
    assert first["season_number"] == 1
    assert first["episode_number"] == 3
    assert first["episode_title"] == "Breakwater"
    assert first["position_seconds"] == 300

    resp = await client.get(
        "/api/v1/history/continue-watching",
        params={**params, "limit": 1},
        headers=auth_headers,
    )
    assert len(resp.json()) == 1


async def test_deleting_profile_removes_history(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    profile: dict[str, Any],
    episode_ids: list[uuid.UUID],
) -> None:
    params = {"profile_id": profile["id"]}
    await client.put(
        progress_url(episode_ids[0]),
        params=params,
        json={"position_seconds": 950, "duration_seconds": 1000},
        headers=auth_headers,
    )
    resp = await client.delete(f"/api/v1/profiles/{profile['id']}", headers=auth_headers)
    assert resp.status_code == 204
    resp = await client.get(
        "/api/v1/history/continue-watching", params=params, headers=auth_headers
    )
    assert resp.status_code == 404


@pytest.fixture
async def long_show(session: AsyncSession) -> list[uuid.UUID]:
    """Episode ids of a 35-episode single-season show."""
    episodes = [Episode(number=n, title=f"Part {n}", duration_seconds=1000) for n in range(1, 36)]
    session.add(Show(title="Long Haul", seasons=[Season(number=1, episodes=episodes)]))
    await session.commit()
    return [ep.id for ep in episodes]


HISTORY_FIELDS = {
    "episode_id",
    "show_id",
    "show_title",
    "poster_url",
    "season_number",
    "episode_number",
    "episode_title",
    "position_seconds",
    "duration_seconds",
    "updated_at",
    "completed",
}


async def watch_all(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    profile_id: str,
    plan: list[tuple[uuid.UUID, int]],
) -> None:
    for episode_id, position in plan:
        r = await client.put(
            progress_url(episode_id),
            params={"profile_id": profile_id},
            json={"position_seconds": position, "duration_seconds": 1000},
            headers=headers,
        )
        assert r.status_code == 200, r.text


async def test_history_lists_completed_and_in_progress_newest_first(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    profile: dict[str, Any],
    shows: list[Show],
    episode_ids: list[uuid.UUID],
) -> None:
    params = {"profile_id": profile["id"]}
    resp = await client.get("/api/v1/history", params=params, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []

    await watch_all(
        client,
        auth_headers,
        profile["id"],
        [(episode_ids[0], 100), (episode_ids[1], 950), (episode_ids[2], 300)],
    )
    # Re-watching the first episode moves it to the top.
    await watch_all(client, auth_headers, profile["id"], [(episode_ids[0], 200)])

    resp = await client.get("/api/v1/history", params=params, headers=auth_headers)
    assert resp.status_code == 200
    items = resp.json()
    assert [(i["episode_id"], i["completed"]) for i in items] == [
        (str(episode_ids[0]), False),
        (str(episode_ids[2]), False),
        (str(episode_ids[1]), True),
    ]
    assert set(items[0]) == HISTORY_FIELDS
    completed = items[2]
    assert completed["show_id"] == str(shows[0].id)
    assert completed["show_title"] == shows[0].title
    assert (completed["season_number"], completed["episode_number"]) == (1, 2)
    assert (completed["position_seconds"], completed["duration_seconds"]) == (950, 1000)
    assert items[0]["position_seconds"] == 200
    stamps = [i["updated_at"] for i in items]
    assert stamps == sorted(stamps, reverse=True)


async def test_history_cursor_paging(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    profile: dict[str, Any],
    long_show: list[uuid.UUID],
) -> None:
    episode_ids = long_show
    await watch_all(
        client,
        auth_headers,
        profile["id"],
        [(e, 950 if n % 2 else 10) for n, e in enumerate(episode_ids[:5])],
    )
    expected = [str(e) for e in reversed(episode_ids[:5])]

    seen: list[str] = []
    before: str | None = None
    while True:
        params: dict[str, Any] = {"profile_id": profile["id"], "limit": 2}
        if before is not None:
            params["before"] = before
        resp = await client.get("/api/v1/history", params=params, headers=auth_headers)
        assert resp.status_code == 200, resp.text
        page = resp.json()
        assert len(page) <= 2
        if not page:
            break
        seen.extend(i["episode_id"] for i in page)
        before = page[-1]["updated_at"]
    assert seen == expected

    # The cursor is strict: items updated exactly at `before` are excluded.
    resp = await client.get(
        "/api/v1/history", params={"profile_id": profile["id"]}, headers=auth_headers
    )
    newest = resp.json()[0]
    resp = await client.get(
        "/api/v1/history",
        params={"profile_id": profile["id"], "before": newest["updated_at"]},
        headers=auth_headers,
    )
    assert [i["episode_id"] for i in resp.json()] == expected[1:]

    # A cursor without an offset is read as UTC.
    resp = await client.get(
        "/api/v1/history",
        params={"profile_id": profile["id"], "before": "2000-01-01T00:00:00"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.parametrize(
    ("params", "status"),
    [
        ({"limit": 0}, 422),
        ({"limit": 101}, 422),
        ({"limit": "x"}, 422),
        ({"before": "yesterday"}, 422),
        ({"limit": 1}, 200),
        ({"limit": 100}, 200),
    ],
)
async def test_history_query_validation(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    profile: dict[str, Any],
    episode_ids: list[uuid.UUID],
    params: dict[str, Any],
    status: int,
) -> None:
    await watch_all(
        client, auth_headers, profile["id"], [(episode_ids[0], 10), (episode_ids[1], 20)]
    )
    resp = await client.get(
        "/api/v1/history", params={"profile_id": profile["id"], **params}, headers=auth_headers
    )
    assert resp.status_code == status, resp.text
    if status == 200:
        assert len(resp.json()) == min(params["limit"], 2)
    else:
        assert resp.headers["content-type"].startswith("application/problem+json")


async def test_history_default_limit_is_30(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    profile: dict[str, Any],
    long_show: list[uuid.UUID],
) -> None:
    await watch_all(client, auth_headers, profile["id"], [(e, 10) for e in long_show[:31]])
    resp = await client.get(
        "/api/v1/history", params={"profile_id": profile["id"]}, headers=auth_headers
    )
    items = resp.json()
    assert len(items) == 30
    assert items[0]["episode_id"] == str(long_show[30])
    assert items[-1]["episode_id"] == str(long_show[1])


async def test_history_is_profile_scoped(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    profile: dict[str, Any],
    other_auth: dict[str, Any],
    episode_ids: list[uuid.UUID],
) -> None:
    await watch_all(client, auth_headers, profile["id"], [(episode_ids[0], 10)])
    params = {"profile_id": profile["id"]}
    resp = await client.get("/api/v1/history", params=params, headers=other_auth["headers"])
    assert resp.status_code == 404
    resp = await client.get(
        "/api/v1/history", params={"profile_id": str(uuid.uuid4())}, headers=auth_headers
    )
    assert resp.status_code == 404
    resp = await client.get("/api/v1/history", params=params)
    assert resp.status_code == 401
    resp = await client.get("/api/v1/history", headers=auth_headers)
    assert resp.status_code == 422  # missing profile_id

    # Another profile of the same account has its own history.
    resp = await client.post("/api/v1/profiles", json={"name": "Kids"}, headers=auth_headers)
    kids = resp.json()["id"]
    resp = await client.get("/api/v1/history", params={"profile_id": kids}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []
