import uuid
from typing import Annotated

from fastapi import Depends
from sqlalchemy import select

from app.db.repository import SQLAlchemyRepository
from app.db.session import DbSession
from app.modules.users.models import User


class UserRepository(SQLAlchemyRepository):
    async def get(self, user_id: uuid.UUID) -> User | None:
        return await self.session.get(User, user_id)

    async def get_by_email(self, email: str) -> User | None:
        result = await self.session.execute(select(User).where(User.email == email.lower()))
        return result.scalar_one_or_none()


def get_user_repository(session: DbSession) -> UserRepository:
    return UserRepository(session)


UserRepositoryDep = Annotated[UserRepository, Depends(get_user_repository)]
