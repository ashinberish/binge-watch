"""Service-level tests for catalog matching (race handling, next-episode ordering)."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.modules.catalog.models import Episode, EpisodeExternalId, Season, Show
from app.modules.catalog.repository import CatalogRepository, EpisodeContext
from app.modules.catalog.schemas import MatchRequest
from app.modules.catalog.service import CatalogService


def service(session: AsyncSession) -> CatalogService:
    return CatalogService(CatalogRepository(session))


def request(**overrides: object) -> MatchRequest:
    data: dict[str, object] = {
        "provider": "netflix",
        "external_id": "123",
        "show_title": "Race Show",
        "season": 1,
        "episode": 1,
    }
    data.update(overrides)
    return MatchRequest.model_validate(data)


async def test_match_recovers_from_concurrent_insert(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Simulate losing the race: the mapping lookup misses, the insert then collides."""
    winner = await service(session).match(request())

    svc = service(session)
    real_lookup = svc.catalog.get_mapped_episode
    calls = 0

    async def stale_first_lookup(provider: str, external_id: str) -> EpisodeContext | None:
        nonlocal calls
        calls += 1
        if calls == 1:
            return None
        return await real_lookup(provider, external_id)

    monkeypatch.setattr(svc.catalog, "get_mapped_episode", stale_first_lookup)
    loser = await svc.match(request())
    assert calls == 2
    assert loser == winner
    mappings = (
        await session.execute(select(func.count()).select_from(EpisodeExternalId))
    ).scalar_one()
    assert mappings == 1


async def test_match_gives_up_after_one_retry(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await service(session).match(request())
    svc = service(session)

    async def always_missing(provider: str, external_id: str) -> EpisodeContext | None:
        return None

    monkeypatch.setattr(svc.catalog, "get_mapped_episode", always_missing)
    with pytest.raises(IntegrityError):
        await svc.match(request())


async def test_next_episode_skips_gaps_and_empty_seasons(session: AsyncSession) -> None:
    show = Show(
        title="Gappy",
        seasons=[
            Season(
                number=1,
                episodes=[
                    Episode(number=1, title="One", duration_seconds=10),
                    Episode(number=4, title="Four", duration_seconds=10),
                ],
            ),
            Season(number=2, episodes=[]),
            Season(number=3, episodes=[Episode(number=2, title="S3E2", duration_seconds=10)]),
        ],
    )
    session.add(show)
    await session.commit()
    svc = service(session)
    s1, _s2, s3 = show.seasons

    nxt = await svc.get_next_episode(s1.episodes[0].id)
    assert (nxt.season_number, nxt.episode_number) == (1, 4)
    nxt = await svc.get_next_episode(s1.episodes[1].id)
    assert (nxt.season_number, nxt.episode_number, nxt.title) == (3, 2, "S3E2")
    with pytest.raises(NotFoundError):
        await svc.get_next_episode(s3.episodes[0].id)


async def test_next_episode_stays_within_show(session: AsyncSession) -> None:
    a = Show(
        title="A",
        seasons=[Season(number=1, episodes=[Episode(number=1, title="a", duration_seconds=1)])],
    )
    b = Show(
        title="B",
        seasons=[Season(number=2, episodes=[Episode(number=1, title="b", duration_seconds=1)])],
    )
    session.add_all([a, b])
    await session.commit()
    with pytest.raises(NotFoundError):
        await service(session).get_next_episode(a.seasons[0].episodes[0].id)


async def test_title_match_prefers_oldest_show(session: AsyncSession) -> None:
    newer = Show(title="Twin", created_at=datetime.now(UTC))
    older = Show(title="TWIN", created_at=datetime.now(UTC) - timedelta(days=1))
    session.add_all([newer, older])
    await session.commit()
    result = await service(session).match(request(show_title="twin"))
    assert result.show_id == older.id
    assert result.show_title == "TWIN"
