import uuid
from collections.abc import Sequence
from typing import Annotated

from fastapi import Depends
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import NotFoundError
from app.core.logging import get_logger
from app.modules.catalog.models import Episode, EpisodeExternalId, Season, Show
from app.modules.catalog.repository import (
    CatalogRepository,
    CatalogRepositoryDep,
    EpisodeContext,
)
from app.modules.catalog.schemas import MatchRequest, MatchResult, NextEpisode

logger = get_logger(__name__)

DEFAULT_SEASON_NUMBER = 1


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

    async def get_next_episode(self, episode_id: uuid.UUID) -> NextEpisode:
        context = await self.catalog.get_episode_context(episode_id)
        if context is None:
            raise NotFoundError("Episode not found.")
        following = await self._next_episode(context)
        if following is None:
            raise NotFoundError("This is the last episode of the show.")
        return following

    async def match(self, data: MatchRequest) -> MatchResult:
        """Resolve a streaming-site episode to a catalog episode, creating it if unseen.

        Concurrent first sightings of the same (provider, external_id) or of the same new
        season/episode collide on unique constraints; the loser rolls back and re-reads,
        which then finds the winner's rows.
        """
        try:
            return await self._match_once(data)
        except IntegrityError:
            await self.catalog.rollback()
            logger.info("catalog.match_retry", provider=data.provider)
        return await self._match_once(data)

    async def _match_once(self, data: MatchRequest) -> MatchResult:
        mapped = await self.catalog.get_mapped_episode(data.provider, data.external_id)
        if mapped is not None:
            return await self._result(mapped)

        context = await self._resolve_or_create(data)
        self.catalog.add(
            EpisodeExternalId(
                provider=data.provider,
                external_id=data.external_id,
                episode_id=context.episode.id,
            )
        )
        await self.catalog.commit()
        logger.info(
            "catalog.matched",
            provider=data.provider,
            show_id=str(context.show.id),
            episode_id=str(context.episode.id),
        )
        return await self._result(context)

    async def _resolve_or_create(self, data: MatchRequest) -> EpisodeContext:
        """Find the episode by show title + numbers; create whatever is missing."""
        show = await self.catalog.find_show_by_title_ci(data.show_title)
        if show is None:
            show = Show(title=data.show_title)
            self.catalog.add(show)
            await self.catalog.flush()

        season_number = data.season if data.season is not None else DEFAULT_SEASON_NUMBER
        season = await self.catalog.get_season(show.id, season_number)
        if season is None:
            season = Season(show_id=show.id, number=season_number)
            self.catalog.add(season)
            await self.catalog.flush()

        episode: Episode | None = None
        if data.episode is not None:
            episode = await self.catalog.get_episode_by_number(season.id, data.episode)
        if episode is None:
            number = data.episode
            if number is None:
                number = (await self.catalog.max_episode_number(season.id) or 0) + 1
            episode = Episode(
                season_id=season.id,
                number=number,
                title=data.episode_title or f"Episode {number}",
                duration_seconds=data.duration_seconds or 0,
            )
            self.catalog.add(episode)
            await self.catalog.flush()
        elif episode.duration_seconds == 0 and data.duration_seconds:
            # Backfill a placeholder created before the player reported a duration.
            episode.duration_seconds = data.duration_seconds
        return EpisodeContext(episode=episode, season=season, show=show)

    async def _next_episode(self, context: EpisodeContext) -> NextEpisode | None:
        row = await self.catalog.get_next_episode(
            context.show.id, context.season.number, context.episode.number
        )
        if row is None:
            return None
        return NextEpisode(
            episode_id=row.episode.id,
            season_number=row.season_number,
            episode_number=row.episode.number,
            title=row.episode.title,
            duration_seconds=row.episode.duration_seconds,
        )

    async def _result(self, context: EpisodeContext) -> MatchResult:
        return MatchResult(
            episode_id=context.episode.id,
            show_id=context.show.id,
            show_title=context.show.title,
            poster_url=context.show.poster_url,
            season_number=context.season.number,
            episode_number=context.episode.number,
            episode_title=context.episode.title,
            duration_seconds=context.episode.duration_seconds,
            next_episode=await self._next_episode(context),
        )


def get_catalog_service(catalog: CatalogRepositoryDep) -> CatalogService:
    return CatalogService(catalog)


CatalogServiceDep = Annotated[CatalogService, Depends(get_catalog_service)]
