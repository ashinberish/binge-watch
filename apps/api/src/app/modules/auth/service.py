from functools import cache
from typing import Annotated

from fastapi import Depends
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings, SettingsDep
from app.core.exceptions import ConflictError, UnauthorizedError
from app.core.logging import get_logger
from app.core.security import (
    InvalidTokenError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
    password_needs_rehash,
    verify_password,
)
from app.core.time import utcnow
from app.modules.auth.models import RefreshToken
from app.modules.auth.repository import RefreshTokenRepository, RefreshTokenRepositoryDep
from app.modules.auth.schemas import LoginRequest, RegisterRequest, TokenPair
from app.modules.users.models import User
from app.modules.users.repository import UserRepository, UserRepositoryDep

logger = get_logger(__name__)


@cache
def _dummy_hash() -> str:
    """Hash verified when the email is unknown, so timing doesn't leak account existence."""
    return hash_password("nightreel-timing-equaliser")


class AuthService:
    def __init__(
        self, users: UserRepository, tokens: RefreshTokenRepository, settings: Settings
    ) -> None:
        self.users = users
        self.tokens = tokens
        self.settings = settings

    async def register(self, data: RegisterRequest) -> User:
        email = data.email.lower()
        if await self.users.get_by_email(email) is not None:
            raise ConflictError("An account with this email already exists.")
        user = User(
            email=email,
            password_hash=hash_password(data.password),
            display_name=data.display_name,
        )
        self.users.add(user)
        try:
            await self.users.commit()
        except IntegrityError as exc:
            await self.users.rollback()
            raise ConflictError("An account with this email already exists.") from exc
        logger.info("auth.registered", user_id=str(user.id))
        return user

    async def login(self, data: LoginRequest) -> TokenPair:
        user = await self.users.get_by_email(data.email)
        if user is None:
            verify_password(data.password, _dummy_hash())
            raise UnauthorizedError("Invalid email or password.")
        if not verify_password(data.password, user.password_hash) or not user.is_active:
            raise UnauthorizedError("Invalid email or password.")
        if password_needs_rehash(user.password_hash):
            user.password_hash = hash_password(data.password)
        return await self._issue_tokens(user)

    async def refresh(self, refresh_token: str) -> TokenPair:
        try:
            decode_token(refresh_token, "refresh", self.settings)
        except InvalidTokenError as exc:
            raise UnauthorizedError("Invalid refresh token.") from exc

        record = await self.tokens.get_by_hash(hash_token(refresh_token))
        if record is None:
            raise UnauthorizedError("Invalid refresh token.")
        now = utcnow()
        if record.is_revoked:
            # A rotated token was presented again: assume theft, kill the whole family.
            await self.tokens.revoke_all_for_user(record.user_id, now)
            await self.tokens.commit()
            logger.warning("auth.refresh_token_reuse", user_id=str(record.user_id))
            raise UnauthorizedError("Refresh token has been revoked.")
        if record.expires_at <= now:
            raise UnauthorizedError("Refresh token has expired.")

        user = await self.users.get(record.user_id)
        if user is None or not user.is_active:
            raise UnauthorizedError("Invalid refresh token.")

        record.revoked_at = now
        return await self._issue_tokens(user)

    async def logout(self, refresh_token: str) -> None:
        """Revoke a refresh token. Unknown tokens are ignored (idempotent, no oracle)."""
        record = await self.tokens.get_by_hash(hash_token(refresh_token))
        if record is not None and not record.is_revoked:
            record.revoked_at = utcnow()
            await self.tokens.commit()

    async def _issue_tokens(self, user: User) -> TokenPair:
        access = create_access_token(user.id, self.settings)
        refresh = create_refresh_token(user.id, self.settings)
        self.tokens.add(
            RefreshToken(
                user_id=user.id,
                token_hash=hash_token(refresh.token),
                expires_at=refresh.expires_at,
            )
        )
        await self.tokens.commit()
        return TokenPair(
            access_token=access.token,
            refresh_token=refresh.token,
            expires_in=access.expires_in,
        )


def get_auth_service(
    users: UserRepositoryDep, tokens: RefreshTokenRepositoryDep, settings: SettingsDep
) -> AuthService:
    return AuthService(users, tokens, settings)


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
