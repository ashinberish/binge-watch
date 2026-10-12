from typing import Annotated

from fastapi import Depends

from app.modules.users.models import User
from app.modules.users.repository import UserRepository, UserRepositoryDep
from app.modules.users.schemas import UserUpdate


class UserService:
    def __init__(self, users: UserRepository) -> None:
        self.users = users

    async def update(self, user: User, data: UserUpdate) -> User:
        changes = data.model_dump(exclude_unset=True, exclude_none=True)
        for field, value in changes.items():
            setattr(user, field, value)
        if changes:
            await self.users.commit()
            await self.users.refresh(user)
        return user


def get_user_service(users: UserRepositoryDep) -> UserService:
    return UserService(users)


UserServiceDep = Annotated[UserService, Depends(get_user_service)]
