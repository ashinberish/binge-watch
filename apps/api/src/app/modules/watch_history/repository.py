import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated

from fastapi import Depends
from sqlalchemy import Select, select

from app.db.repository import SQLAlchemyRepository
from app.db.session import DbSession
from app.modules.catalog.models import Episode, Season, Show
from app.modules.watch_history.models import WatchProgress


@dataclass(frozen=True, slots=True)
class ContinueWatchingRow:
    episode_id: uuid.UUID
    show_id: uuid.UUID
    show_title: str
    poster_url: str | None
    season_number: int
    episode_number: int
    episode_title: str
    position_seconds: int
    duration_seconds: int
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class HistoryRow(ContinueWatchingRow):
    completed: bool


# Columns shared by continue-watching and history rows (labels = dataclass fields).
_ITEM_COLUMNS = (
    WatchProgress.episode_id.label("episode_id"),
    Show.id.label("show_id"),
    Show.title.label("show_title"),
    Show.poster_url.label("poster_url"),
    Season.number.label("season_number"),
    Episode.number.label("episode_number"),
    Episode.title.label("episode_title"),
    WatchProgress.position_seconds.label("position_seconds"),
    WatchProgress.duration_seconds.label("duration_seconds"),
    WatchProgress.updated_at.label("updated_at"),
)


def _with_episode[*Ts](stmt: Select[*Ts]) -> Select[*Ts]:
    """Join the episode, its season and show onto a ``watch_progress`` select."""
    return (
        stmt.join(Episode, Episode.id == WatchProgress.episode_id)
        .join(Season, Season.id == Episode.season_id)
        .join(Show, Show.id == Season.show_id)
    )


class WatchHistoryRepository(SQLAlchemyRepository):
    async def get(self, profile_id: uuid.UUID, episode_id: uuid.UUID) -> WatchProgress | None:
        result = await self.session.execute(
            select(WatchProgress).where(
                WatchProgress.profile_id == profile_id, WatchProgress.episode_id == episode_id
            )
        )
        return result.scalar_one_or_none()

    async def continue_watching(
        self, profile_id: uuid.UUID, *, limit: int
    ) -> list[ContinueWatchingRow]:
        stmt = (
            _with_episode(select(*_ITEM_COLUMNS))
            .where(WatchProgress.profile_id == profile_id, WatchProgress.completed.is_(False))
            .order_by(WatchProgress.updated_at.desc(), WatchProgress.id)
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return [ContinueWatchingRow(**row._asdict()) for row in result.all()]

    async def history(
        self, profile_id: uuid.UUID, *, limit: int, before: datetime | None = None
    ) -> list[HistoryRow]:
        """Completed and in-progress episodes, most recently updated first. ``before`` is a
        cursor: only rows updated strictly earlier are returned."""
        stmt = _with_episode(
            select(*_ITEM_COLUMNS, WatchProgress.completed.label("completed"))
        ).where(WatchProgress.profile_id == profile_id)
        if before is not None:
            stmt = stmt.where(WatchProgress.updated_at < before)
        stmt = stmt.order_by(WatchProgress.updated_at.desc(), WatchProgress.id).limit(limit)
        result = await self.session.execute(stmt)
        return [HistoryRow(**row._asdict()) for row in result.all()]


def get_watch_history_repository(session: DbSession) -> WatchHistoryRepository:
    return WatchHistoryRepository(session)


WatchHistoryRepositoryDep = Annotated[WatchHistoryRepository, Depends(get_watch_history_repository)]
