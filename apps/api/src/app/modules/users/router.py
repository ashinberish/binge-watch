from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.core.exceptions import problem_responses
from app.modules.users.schemas import UserRead, UserUpdate
from app.modules.users.service import UserServiceDep

router = APIRouter(prefix="/users", tags=["users"], responses=problem_responses(401))


@router.get("/me", response_model=UserRead, operation_id="users_get_me")
async def get_me(user: CurrentUser) -> UserRead:
    """Return the authenticated account."""
    return UserRead.model_validate(user)


@router.patch(
    "/me",
    response_model=UserRead,
    operation_id="users_update_me",
    responses=problem_responses(422),
)
async def update_me(data: UserUpdate, user: CurrentUser, service: UserServiceDep) -> UserRead:
    """Update the authenticated account's mutable fields."""
    return UserRead.model_validate(await service.update(user, data))
