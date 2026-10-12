import uuid
from collections.abc import Sequence
from typing import Annotated

from fastapi import Depends

from app.core.exceptions import ConflictError, NotFoundError
from app.modules.profiles.models import MAX_PROFILES_PER_USER, Profile
from app.modules.profiles.repository import ProfileRepository, ProfileRepositoryDep
from app.modules.profiles.schemas import ProfileCreate, ProfileUpdate


class ProfileService:
    def __init__(self, profiles: ProfileRepository) -> None:
        self.profiles = profiles

    async def list_for_user(self, user_id: uuid.UUID) -> Sequence[Profile]:
        return await self.profiles.list_for_user(user_id)

    async def get_owned(self, user_id: uuid.UUID, profile_id: uuid.UUID) -> Profile:
        """Return the profile if it belongs to ``user_id``; 404 otherwise (no existence leak)."""
        profile = await self.profiles.get_for_user(profile_id, user_id)
        if profile is None:
            raise NotFoundError("Profile not found.")
        return profile

    async def create(self, user_id: uuid.UUID, data: ProfileCreate) -> Profile:
        if await self.profiles.count_for_user(user_id) >= MAX_PROFILES_PER_USER:
            raise ConflictError(f"An account can have at most {MAX_PROFILES_PER_USER} profiles.")
        profile = Profile(user_id=user_id, **data.model_dump())
        self.profiles.add(profile)
        await self.profiles.commit()
        return profile

    async def update(
        self, user_id: uuid.UUID, profile_id: uuid.UUID, data: ProfileUpdate
    ) -> Profile:
        profile = await self.get_owned(user_id, profile_id)
        changes = data.model_dump(exclude_unset=True, exclude_none=True)
        for field, value in changes.items():
            setattr(profile, field, value)
        if changes:
            await self.profiles.commit()
            await self.profiles.refresh(profile)
        return profile

    async def delete(self, user_id: uuid.UUID, profile_id: uuid.UUID) -> None:
        profile = await self.get_owned(user_id, profile_id)
        await self.profiles.delete(profile)
        await self.profiles.commit()


def get_profile_service(profiles: ProfileRepositoryDep) -> ProfileService:
    return ProfileService(profiles)


ProfileServiceDep = Annotated[ProfileService, Depends(get_profile_service)]
