import uuid
from typing import Any

import httpx

from app.modules.catalog.models import Show


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
