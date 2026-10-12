import uuid
from typing import Annotated

from fastapi import Depends
from sqlalchemy import select

from app.db.repository import SQLAlchemyRepository
from app.db.session import DbSession
from app.modules.streaks.models import Streak


class StreakRepository(SQLAlchemyRepository):
    async def get_by_profile(self, profile_id: uuid.UUID) -> Streak | None:
        result = await self.session.execute(select(Streak).where(Streak.profile_id == profile_id))
        return result.scalar_one_or_none()


def get_streak_repository(session: DbSession) -> StreakRepository:
    return StreakRepository(session)


StreakRepositoryDep = Annotated[StreakRepository, Depends(get_streak_repository)]
