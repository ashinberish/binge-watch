import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser
from app.core.exceptions import problem_responses
from app.modules.streaks.schemas import StreakRead
from app.modules.streaks.service import StreakServiceDep

router = APIRouter(prefix="/streaks", tags=["streaks"], responses=problem_responses(401))


@router.get(
    "/current",
    response_model=StreakRead,
    operation_id="streaks_get_current",
    responses=problem_responses(404, 422),
)
async def get_current_streak(
    profile_id: Annotated[uuid.UUID, Query()], user: CurrentUser, service: StreakServiceDep
) -> StreakRead:
    """Current and longest binge streak for a profile."""
    return await service.get_current(user.id, profile_id)
