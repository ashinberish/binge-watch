"""Cross-cutting FastAPI dependencies shared by all routers."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, SettingsDep
from app.core.exceptions import UnauthorizedError
from app.core.security import InvalidTokenError, decode_token
from app.db.session import DbSession
from app.modules.users.models import User
from app.modules.users.repository import UserRepository, UserRepositoryDep

__all__ = ["CurrentUser", "DbSession", "Pagination", "PaginationDep", "SettingsDep"]


async def user_from_access_token(
    token: str, users: UserRepository, settings: Settings
) -> User | None:
    """The active user an access JWT belongs to, or None if the token or user is invalid.

    Shared by bearer auth and the watch-party WebSocket (which authenticates in-band).
    """
    try:
        claims = decode_token(token, "access", settings)
    except InvalidTokenError:
        return None
    user = await users.get(claims.subject)
    if user is None or not user.is_active:
        return None
    return user


_bearer = HTTPBearer(auto_error=False, description="Access token from `POST /auth/login`.")


async def get_current_user(
    users: UserRepositoryDep,
    settings: SettingsDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise UnauthorizedError("Missing bearer token.")
    user = await user_from_access_token(credentials.credentials, users, settings)
    if user is None:
        raise UnauthorizedError("Invalid or expired access token.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


@dataclass(frozen=True, slots=True)
class Pagination:
    limit: int
    offset: int


def get_pagination(
    limit: Annotated[int, Query(ge=1, le=100, description="Maximum items to return.")] = 20,
    offset: Annotated[int, Query(ge=0, description="Number of items to skip.")] = 0,
) -> Pagination:
    return Pagination(limit=limit, offset=offset)


PaginationDep = Annotated[Pagination, Depends(get_pagination)]
