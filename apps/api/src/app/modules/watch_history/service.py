import uuid
from typing import Annotated

from fastapi import Depends

from app.core.time import utcnow
from app.modules.catalog.service import CatalogService, CatalogServiceDep
from app.modules.profiles.service import ProfileService, ProfileServiceDep
from app.modules.streaks.service import StreakService, StreakServiceDep
from app.modules.watch_history.models import WatchProgress
from app.modules.watch_history.repository import (
    ContinueWatchingRow,
    WatchHistoryRepository,
    WatchHistoryRepositoryDep,
)
from app.modules.watch_history.schemas import ProgressUpdate

COMPLETION_THRESHOLD_PERCENT = 90


def is_completed(position_seconds: int, duration_seconds: int) -> bool:
    """An episode counts as watched once 90% of it has been played (integer-exact)."""
    return position_seconds * 100 >= duration_seconds * COMPLETION_THRESHOLD_PERCENT


class WatchHistoryService:
    def __init__(
        self,
        history: WatchHistoryRepository,
        profiles: ProfileService,
        catalog: CatalogService,
        streaks: StreakService,
    ) -> None:
        self.history = history
        self.profiles = profiles
        self.catalog = catalog
        self.streaks = streaks

    async def update_progress(
        self,
        user_id: uuid.UUID,
        profile_id: uuid.UUID,
        episode_id: uuid.UUID,
        data: ProgressUpdate,
    ) -> WatchProgress:
        await self.profiles.get_owned(user_id, profile_id)
        await self.catalog.get_episode(episode_id)

        now = utcnow()
        position = min(data.position_seconds, data.duration_seconds)
        completed = is_completed(position, data.duration_seconds)

        progress = await self.history.get(profile_id, episode_id)
        was_completed = progress.completed if progress is not None else False
        if progress is None:
            progress = WatchProgress(profile_id=profile_id, episode_id=episode_id)
            self.history.add(progress)
        progress.position_seconds = position
        progress.duration_seconds = data.duration_seconds
        progress.completed = completed
        progress.updated_at = now

        if completed and not was_completed:
            await self.streaks.record_completion(profile_id, now)

        await self.history.commit()
        return progress

    async def continue_watching(
        self, user_id: uuid.UUID, profile_id: uuid.UUID, *, limit: int
    ) -> list[ContinueWatchingRow]:
        await self.profiles.get_owned(user_id, profile_id)
        return await self.history.continue_watching(profile_id, limit=limit)


def get_watch_history_service(
    history: WatchHistoryRepositoryDep,
    profiles: ProfileServiceDep,
    catalog: CatalogServiceDep,
    streaks: StreakServiceDep,
) -> WatchHistoryService:
    return WatchHistoryService(history, profiles, catalog, streaks)


WatchHistoryServiceDep = Annotated[WatchHistoryService, Depends(get_watch_history_service)]
