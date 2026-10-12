import uuid

from fastapi import APIRouter, status

from app.api.deps import CurrentUser
from app.core.exceptions import problem_responses
from app.modules.profiles.schemas import ProfileCreate, ProfileRead, ProfileUpdate
from app.modules.profiles.service import ProfileServiceDep

router = APIRouter(prefix="/profiles", tags=["profiles"], responses=problem_responses(401))


@router.get("", response_model=list[ProfileRead], operation_id="profiles_list")
async def list_profiles(user: CurrentUser, service: ProfileServiceDep) -> list[ProfileRead]:
    """List the viewer profiles of the authenticated account."""
    return [ProfileRead.model_validate(p) for p in await service.list_for_user(user.id)]


@router.post(
    "",
    response_model=ProfileRead,
    status_code=status.HTTP_201_CREATED,
    operation_id="profiles_create",
    responses=problem_responses(409, 422),
)
async def create_profile(
    data: ProfileCreate, user: CurrentUser, service: ProfileServiceDep
) -> ProfileRead:
    """Create a profile (maximum 5 per account)."""
    return ProfileRead.model_validate(await service.create(user.id, data))


@router.patch(
    "/{profile_id}",
    response_model=ProfileRead,
    operation_id="profiles_update",
    responses=problem_responses(404, 422),
)
async def update_profile(
    profile_id: uuid.UUID, data: ProfileUpdate, user: CurrentUser, service: ProfileServiceDep
) -> ProfileRead:
    """Partially update a profile."""
    return ProfileRead.model_validate(await service.update(user.id, profile_id, data))


@router.delete(
    "/{profile_id}",
    response_model=None,
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="profiles_delete",
    responses=problem_responses(404, 422),
)
async def delete_profile(
    profile_id: uuid.UUID, user: CurrentUser, service: ProfileServiceDep
) -> None:
    """Delete a profile together with its watch history and streak."""
    await service.delete(user.id, profile_id)
