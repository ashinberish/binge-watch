import uuid
from collections.abc import Sequence
from typing import Annotated

from fastapi import Depends
from sqlalchemy import func, select

from app.db.repository import SQLAlchemyRepository
from app.db.session import DbSession
from app.modules.profiles.models import Profile


class ProfileRepository(SQLAlchemyRepository):
    async def list_for_user(self, user_id: uuid.UUID) -> Sequence[Profile]:
        result = await self.session.execute(
            select(Profile)
            .where(Profile.user_id == user_id)
            .order_by(Profile.created_at, Profile.id)
        )
        return result.scalars().all()

    async def count_for_user(self, user_id: uuid.UUID) -> int:
        result = await self.session.execute(
            select(func.count()).select_from(Profile).where(Profile.user_id == user_id)
        )
        return int(result.scalar_one())

    async def get_for_user(self, profile_id: uuid.UUID, user_id: uuid.UUID) -> Profile | None:
        result = await self.session.execute(
            select(Profile).where(Profile.id == profile_id, Profile.user_id == user_id)
        )
        return result.scalar_one_or_none()


def get_profile_repository(session: DbSession) -> ProfileRepository:
    return ProfileRepository(session)


ProfileRepositoryDep = Annotated[ProfileRepository, Depends(get_profile_repository)]
