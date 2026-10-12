import uuid
from collections.abc import Sequence
from typing import Annotated

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.repository import SQLAlchemyRepository
from app.db.session import DbSession
from app.modules.catalog.models import Episode, Season, Show


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


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


def get_catalog_repository(session: DbSession) -> CatalogRepository:
    return CatalogRepository(session)


CatalogRepositoryDep = Annotated[CatalogRepository, Depends(get_catalog_repository)]
