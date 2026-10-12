import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser
from app.core.exceptions import problem_responses
from app.modules.watch_history.schemas import (
    ContinueWatchingItem,
    ProgressUpdate,
    WatchProgressRead,
)
from app.modules.watch_history.service import WatchHistoryServiceDep

router = APIRouter(prefix="/history", tags=["watch_history"], responses=problem_responses(401))

ProfileIdQuery = Annotated[uuid.UUID, Query(description="Profile the request acts on.")]


@router.put(
    "/{episode_id}/progress",
    response_model=WatchProgressRead,
    operation_id="history_update_progress",
    responses=problem_responses(404, 422),
)
async def update_progress(
    episode_id: uuid.UUID,
    profile_id: ProfileIdQuery,
    data: ProgressUpdate,
    user: CurrentUser,
    service: WatchHistoryServiceDep,
) -> WatchProgressRead:
    """Record playback progress. Reaching 90% marks the episode completed and feeds the streak."""
    progress = await service.update_progress(user.id, profile_id, episode_id, data)
    return WatchProgressRead.model_validate(progress)


@router.get(
    "/continue-watching",
    response_model=list[ContinueWatchingItem],
    operation_id="history_continue_watching",
    responses=problem_responses(404, 422),
)
async def continue_watching(
    profile_id: ProfileIdQuery,
    user: CurrentUser,
    service: WatchHistoryServiceDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[ContinueWatchingItem]:
    """Unfinished episodes for a profile, most recently watched first."""
    rows = await service.continue_watching(user.id, profile_id, limit=limit)
    return [ContinueWatchingItem.model_validate(row) for row in rows]
