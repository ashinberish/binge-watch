import uuid
from collections.abc import Sequence
from typing import Annotated

from fastapi import Depends

from app.core.exceptions import NotFoundError
from app.modules.catalog.models import Episode, Show
from app.modules.catalog.repository import CatalogRepository, CatalogRepositoryDep


class CatalogService:
    def __init__(self, catalog: CatalogRepository) -> None:
        self.catalog = catalog

    async def search_shows(self, query: str | None, *, limit: int, offset: int) -> Sequence[Show]:
        cleaned = query.strip() if query else None
        return await self.catalog.list_shows(query=cleaned or None, limit=limit, offset=offset)

    async def get_show(self, show_id: uuid.UUID) -> Show:
        show = await self.catalog.get_show_with_episodes(show_id)
        if show is None:
            raise NotFoundError("Show not found.")
        return show

    async def get_episode(self, episode_id: uuid.UUID) -> Episode:
        episode = await self.catalog.get_episode(episode_id)
        if episode is None:
            raise NotFoundError("Episode not found.")
        return episode


def get_catalog_service(catalog: CatalogRepositoryDep) -> CatalogService:
    return CatalogService(catalog)


CatalogServiceDep = Annotated[CatalogService, Depends(get_catalog_service)]
