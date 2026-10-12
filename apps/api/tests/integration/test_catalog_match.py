"""POST /catalog/match and GET /catalog/episodes/{id}/next."""

import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.catalog.models import Episode, EpisodeExternalId, Season, Show

MATCH = "/api/v1/catalog/match"


async def match(client: httpx.AsyncClient, headers: dict[str, str], **body: Any) -> dict[str, Any]:
    payload = {"provider": "netflix", "external_id": "80000001", **body}
    resp = await client.post(MATCH, json=payload, headers=headers)
    assert resp.status_code == 200, resp.text
    data: dict[str, Any] = resp.json()
    return data


async def count(session: AsyncSession, model: type[Any]) -> int:
    return (await session.execute(select(func.count()).select_from(model))).scalar_one()


async def test_match_existing_episode_case_insensitive(
    client: httpx.AsyncClient, auth_headers: dict[str, str], shows: list[Show]
) -> None:
    archive = next(s for s in shows if s.title == "The Midnight Archive")
    body = await match(
        client, auth_headers, show_title="  the MIDNIGHT archive ", season=1, episode=2
    )
    assert set(body) == {
        "episode_id",
        "show_id",
        "show_title",
        "poster_url",
        "season_number",
        "episode_number",
        "episode_title",
        "duration_seconds",
        "next_episode",
    }
    assert body["show_id"] == str(archive.id)
    assert body["show_title"] == "The Midnight Archive"
    assert (body["season_number"], body["episode_number"]) == (1, 2)
    assert body["episode_title"] == "Marginalia"
    assert body["duration_seconds"] == 2700
    assert body["episode_id"] == str(archive.seasons[0].episodes[1].id)
    assert body["next_episode"] == {
        "episode_id": str(archive.seasons[0].episodes[2].id),
        "season_number": 1,
        "episode_number": 3,
        "title": "The Stacks",
        "duration_seconds": 2950,
    }


async def test_match_reuses_mapping(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    shows: list[Show],
    session: AsyncSession,
) -> None:
    first = await match(
        client, auth_headers, show_title="The Midnight Archive", season=1, episode=1
    )
    # Once mapped, the external id alone decides, whatever the page now says.
    again = await match(client, auth_headers, show_title="Something Else", season=9, episode=9)
    assert again == first
    assert await count(session, EpisodeExternalId) == 1
    assert await count(session, Show) == 3

    # Same external id under another provider is a different mapping.
    other = await match(
        client,
        auth_headers,
        provider="disney-plus",
        show_title="Signal & Noise",
        season=1,
        episode=1,
    )
    assert other["episode_id"] != first["episode_id"]
    assert await count(session, EpisodeExternalId) == 2


async def test_match_next_episode_crosses_seasons(
    client: httpx.AsyncClient, auth_headers: dict[str, str], shows: list[Show]
) -> None:
    archive = next(s for s in shows if s.title == "The Midnight Archive")
    body = await match(client, auth_headers, show_title="The Midnight Archive", season=1, episode=3)
    assert body["next_episode"]["episode_id"] == str(archive.seasons[1].episodes[0].id)
    assert body["next_episode"]["season_number"] == 2
    assert body["next_episode"]["episode_number"] == 1

    last = await match(
        client,
        auth_headers,
        external_id="80000099",
        show_title="The Midnight Archive",
        season=2,
        episode=2,
    )
    assert last["next_episode"] is None


async def test_match_creates_show_from_first_sight(
    client: httpx.AsyncClient, auth_headers: dict[str, str], session: AsyncSession
) -> None:
    body = await match(
        client,
        auth_headers,
        show_title="Brand New Show",
        episode_title="Pilot",
        season=2,
        episode=5,
        duration_seconds=1800,
    )
    assert body["show_title"] == "Brand New Show"
    assert body["poster_url"] is None
    assert (body["season_number"], body["episode_number"]) == (2, 5)
    assert body["episode_title"] == "Pilot"
    assert body["duration_seconds"] == 1800
    assert body["next_episode"] is None

    # A later episode of the same show lands in the same show/season.
    nxt = await match(
        client,
        auth_headers,
        external_id="80000002",
        show_title="brand new show",
        season=2,
        episode=6,
    )
    assert nxt["show_id"] == body["show_id"]
    assert nxt["episode_title"] == "Episode 6"
    assert nxt["duration_seconds"] == 0

    again = await match(client, auth_headers, show_title="Brand New Show")
    assert again["next_episode"]["episode_id"] == nxt["episode_id"]
    assert await count(session, Show) == 1
    assert await count(session, Season) == 1
    assert await count(session, Episode) == 2


async def test_match_without_numbers_appends_to_season_one(
    client: httpx.AsyncClient, auth_headers: dict[str, str]
) -> None:
    a = await match(client, auth_headers, external_id="a", show_title="Mini Series")
    b = await match(
        client, auth_headers, external_id="b", show_title="Mini Series", episode_title="  "
    )
    assert (a["season_number"], a["episode_number"], a["episode_title"]) == (1, 1, "Episode 1")
    assert (b["season_number"], b["episode_number"], b["episode_title"]) == (1, 2, "Episode 2")
    assert a["next_episode"] is None  # computed at match time

    resp = await client.get(
        f"/api/v1/catalog/episodes/{a['episode_id']}/next", headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["episode_id"] == b["episode_id"]


async def test_match_season_zero_and_existing_show_new_season(
    client: httpx.AsyncClient, auth_headers: dict[str, str], shows: list[Show]
) -> None:
    special = await match(
        client,
        auth_headers,
        external_id="special",
        show_title="Signal & Noise",
        season=0,
        episode=1,
        episode_title="Behind the Signal",
    )
    assert special["season_number"] == 0
    # Specials lead into season 1.
    assert special["next_episode"]["season_number"] == 1
    assert special["next_episode"]["episode_number"] == 1

    new_season = await match(
        client, auth_headers, external_id="s9", show_title="Signal & Noise", season=9
    )
    assert (new_season["season_number"], new_season["episode_number"]) == (9, 1)
    assert new_season["show_id"] == str(next(s.id for s in shows if s.title == "Signal & Noise"))


async def test_match_backfills_placeholder_duration(
    client: httpx.AsyncClient, auth_headers: dict[str, str]
) -> None:
    first = await match(client, auth_headers, external_id="x1", show_title="Pending", episode=1)
    assert first["duration_seconds"] == 0
    second = await match(
        client,
        auth_headers,
        provider="hulu",
        external_id="h1",
        show_title="Pending",
        season=1,
        episode=1,
        duration_seconds=1500,
    )
    assert second["episode_id"] == first["episode_id"]
    assert second["duration_seconds"] == 1500


@pytest.mark.parametrize(
    "override",
    [
        {"provider": "Netflix"},
        {"provider": "net flix"},
        {"provider": "x" * 33},
        {"provider": ""},
        {"external_id": ""},
        {"external_id": "x" * 256},
        {"show_title": "   "},
        {"show_title": "x" * 256},
        {"season": -1},
        {"episode": 0},
        {"duration_seconds": 0},
    ],
)
async def test_match_validation(
    client: httpx.AsyncClient, auth_headers: dict[str, str], override: dict[str, Any]
) -> None:
    payload = {"provider": "netflix", "external_id": "1", "show_title": "Show", **override}
    resp = await client.post(MATCH, json=payload, headers=auth_headers)
    assert resp.status_code == 422
    assert resp.headers["content-type"] == "application/problem+json"


async def test_match_requires_auth(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        MATCH, json={"provider": "netflix", "external_id": "1", "show_title": "Show"}
    )
    assert resp.status_code == 401
    assert resp.headers["content-type"] == "application/problem+json"


async def test_get_next_episode(
    client: httpx.AsyncClient, auth_headers: dict[str, str], shows: list[Show]
) -> None:
    archive = next(s for s in shows if s.title == "The Midnight Archive")
    s1, s2 = archive.seasons
    resp = await client.get(
        f"/api/v1/catalog/episodes/{s1.episodes[0].id}/next", headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json() == {
        "episode_id": str(s1.episodes[1].id),
        "season_number": 1,
        "episode_number": 2,
        "title": "Marginalia",
        "duration_seconds": 2700,
    }

    resp = await client.get(
        f"/api/v1/catalog/episodes/{s1.episodes[-1].id}/next", headers=auth_headers
    )
    assert resp.json()["episode_id"] == str(s2.episodes[0].id)

    resp = await client.get(
        f"/api/v1/catalog/episodes/{s2.episodes[-1].id}/next", headers=auth_headers
    )
    assert resp.status_code == 404
    assert resp.headers["content-type"] == "application/problem+json"


async def test_get_next_episode_not_found_and_auth(
    client: httpx.AsyncClient, auth_headers: dict[str, str]
) -> None:
    url = f"/api/v1/catalog/episodes/{uuid.uuid4()}/next"
    resp = await client.get(url, headers=auth_headers)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Episode not found."
    assert (await client.get(url)).status_code == 401
    bad = await client.get("/api/v1/catalog/episodes/nope/next", headers=auth_headers)
    assert bad.status_code == 422


async def test_mapping_deleted_with_episode(
    client: httpx.AsyncClient, auth_headers: dict[str, str], session: AsyncSession
) -> None:
    body = await match(client, auth_headers, show_title="Doomed", episode=1)
    episode = await session.get(Episode, uuid.UUID(body["episode_id"]))
    assert episode is not None
    await session.delete(episode)
    await session.commit()
    assert await count(session, EpisodeExternalId) == 0

    recreated = await match(client, auth_headers, show_title="Doomed", episode=1)
    assert recreated["episode_id"] != body["episode_id"]
