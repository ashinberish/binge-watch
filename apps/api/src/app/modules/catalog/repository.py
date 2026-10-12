import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends
from sqlalchemy import Row, Select, and_, func, or_, select
from sqlalchemy.orm import selectinload

from app.db.repository import SQLAlchemyRepository
from app.db.session import DbSession
from app.modules.catalog.models import Episode, EpisodeExternalId, Season, Show


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@dataclass(frozen=True, slots=True)
class EpisodeContext:
    """An episode together with its season and show (one joined row)."""

    episode: Episode
    season: Season
    show: Show


@dataclass(frozen=True, slots=True)
class NextEpisodeRow:
    episode: Episode
    season_number: int


def _episode_context() -> Select[Episode, Season, Show]:
    return (
        select(Episode, Season, Show)
        .join(Season, Episode.season_id == Season.id)
        .join(Show, Season.show_id == Show.id)
    )


def _to_context(row: Row[Episode, Season, Show] | None) -> EpisodeContext | None:
    if row is None:
        return None
    episode, season, show = row
    return EpisodeContext(episode=episode, season=season, show=show)


class CatalogRepository(SQLAlchemyRepository):
    async def list_shows(self, *, query: str | None, limit: int, offset: int) -> Sequence[Show]:
        stmt = select(Show)
        if query:
            stmt = stmt.where(Show.title.ilike(f"%{_escape_like(query)}%", escape="\\"))
        stmt = stmt.order_by(Show.title, Show.id).limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def get_show_with_episodes(self, show_id: uuid.UUID) -> Show | None:
        result = await self.session.execute(
            select(Show)
            .where(Show.id == show_id)
            .options(selectinload(Show.seasons).selectinload(Season.episodes))
        )
        return result.scalar_one_or_none()

    async def get_episode(self, episode_id: uuid.UUID) -> Episode | None:
        return await self.session.get(Episode, episode_id)

    async def get_show_by_title(self, title: str) -> Show | None:
        result = await self.session.execute(select(Show).where(Show.title == title))
        return result.scalars().first()

    async def find_show_by_title_ci(self, title: str) -> Show | None:
        """Case-insensitive exact title match; the oldest show wins if titles collide."""
        result = await self.session.execute(
            select(Show)
            .where(func.lower(Show.title) == title.lower())
            .order_by(Show.created_at, Show.id)
            .limit(1)
        )
        return result.scalars().first()

    async def get_episode_context(self, episode_id: uuid.UUID) -> EpisodeContext | None:
        result = await self.session.execute(_episode_context().where(Episode.id == episode_id))
        return _to_context(result.one_or_none())

    async def get_mapped_episode(self, provider: str, external_id: str) -> EpisodeContext | None:
        """The episode a provider's external id was previously matched to, if any."""
        result = await self.session.execute(
            _episode_context()
            .join(EpisodeExternalId, EpisodeExternalId.episode_id == Episode.id)
            .where(
                EpisodeExternalId.provider == provider,
                EpisodeExternalId.external_id == external_id,
            )
        )
        return _to_context(result.one_or_none())

    async def get_season(self, show_id: uuid.UUID, number: int) -> Season | None:
        result = await self.session.execute(
            select(Season).where(Season.show_id == show_id, Season.number == number)
        )
        return result.scalar_one_or_none()

    async def get_episode_by_number(self, season_id: uuid.UUID, number: int) -> Episode | None:
        result = await self.session.execute(
            select(Episode).where(Episode.season_id == season_id, Episode.number == number)
        )
        return result.scalar_one_or_none()

    async def max_episode_number(self, season_id: uuid.UUID) -> int | None:
        result = await self.session.execute(
            select(func.max(Episode.number)).where(Episode.season_id == season_id)
        )
        return result.scalar_one_or_none()

    async def get_next_episode(
        self, show_id: uuid.UUID, season_number: int, episode_number: int
    ) -> NextEpisodeRow | None:
        """The episode after (season, episode) in watch order within a show.

        That is the next-numbered episode of the same season, otherwise the first
        episode of the next season that has any episodes.
        """
        result = await self.session.execute(
            select(Episode, Season.number)
            .join(Season, Episode.season_id == Season.id)
            .where(
                Season.show_id == show_id,
                or_(
                    Season.number > season_number,
                    and_(Season.number == season_number, Episode.number > episode_number),
                ),
            )
            .order_by(Season.number, Episode.number)
            .limit(1)
        )
        row = result.one_or_none()
        if row is None:
            return None
        episode, season_number = row
        return NextEpisodeRow(episode=episode, season_number=season_number)


def get_catalog_repository(session: DbSession) -> CatalogRepository:
    return CatalogRepository(session)


CatalogRepositoryDep = Annotated[CatalogRepository, Depends(get_catalog_repository)]
