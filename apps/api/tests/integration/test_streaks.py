import uuid
from typing import Any

import httpx


async def test_streak_starts_empty(
    client: httpx.AsyncClient, auth_headers: dict[str, str], profile: dict[str, Any]
) -> None:
    resp = await client.get(
        "/api/v1/streaks/current", params={"profile_id": profile["id"]}, headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json() == {"current_days": 0, "longest_days": 0, "episodes_today": 0}


async def test_completing_episodes_updates_streak(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    profile: dict[str, Any],
    episode_ids: list[uuid.UUID],
) -> None:
    params = {"profile_id": profile["id"]}
    for episode_id in episode_ids[:2]:
        for position in (500, 950, 990):  # repeated completion counts once
            await client.put(
                f"/api/v1/history/{episode_id}/progress",
                params=params,
                json={"position_seconds": position, "duration_seconds": 1000},
                headers=auth_headers,
            )
    resp = await client.get("/api/v1/streaks/current", params=params, headers=auth_headers)
    assert resp.json() == {"current_days": 1, "longest_days": 1, "episodes_today": 2}


async def test_streak_requires_profile_id(
    client: httpx.AsyncClient, auth_headers: dict[str, str]
) -> None:
    resp = await client.get("/api/v1/streaks/current", headers=auth_headers)
    assert resp.status_code == 422
