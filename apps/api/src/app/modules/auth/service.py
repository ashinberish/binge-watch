import secrets
import uuid
from datetime import timedelta
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
from app.modules.auth import schemas
from app.modules.auth.models import ExtensionCode, RefreshToken
from app.modules.auth.repository import (
    ExtensionCodeRepository,
    ExtensionCodeRepositoryDep,
    RefreshTokenRepository,
    RefreshTokenRepositoryDep,
)
from app.modules.auth.schemas import (
    ExtensionTokenRequest,
    LoginRequest,
    RegisterRequest,
    TokenPair,
)
from app.modules.users.models import User
from app.modules.users.repository import UserRepository, UserRepositoryDep

logger = get_logger(__name__)

EXTENSION_CODE_BYTES = 32
EXTENSION_CODE_RETENTION = timedelta(days=1)


@cache
def _dummy_hash() -> str:
    """Hash verified when the email is unknown, so timing doesn't leak account existence."""
    return hash_password("nightreel-timing-equaliser")


class AuthService:
    def __init__(
        self,
        users: UserRepository,
        tokens: RefreshTokenRepository,
        codes: ExtensionCodeRepository,
        settings: Settings,
    ) -> None:
        self.users = users
        self.tokens = tokens
        self.codes = codes
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

    async def create_extension_code(
        self, user_id: uuid.UUID, redirect_uri: str
    ) -> schemas.ExtensionCode:
        """Issue a single-use code the web app hands to the extension via its redirect URI."""
        code = secrets.token_urlsafe(EXTENSION_CODE_BYTES)
        ttl = self.settings.extension_code_ttl_seconds
        self.codes.add(
            ExtensionCode(
                user_id=user_id,
                code_hash=hash_token(code),
                redirect_uri=redirect_uri,
                expires_at=utcnow() + timedelta(seconds=ttl),
            )
        )
        await self.codes.commit()
        logger.info("auth.extension_code_issued", user_id=str(user_id))
        return schemas.ExtensionCode(code=code, expires_in=ttl)

    async def exchange_extension_code(self, data: ExtensionTokenRequest) -> TokenPair:
        """Redeem an extension code for a token pair. Every failure looks the same (401)."""
        record = await self.codes.get_by_hash(hash_token(data.code))
        now = utcnow()
        if (
            record is None
            or record.is_used
            or record.expires_at <= now
            or not secrets.compare_digest(record.redirect_uri, data.redirect_uri)
        ):
            raise UnauthorizedError("Invalid or expired extension code.")
        if not await self.codes.claim(record.id, now):
            raise UnauthorizedError("Invalid or expired extension code.")

        user = await self.users.get(record.user_id)
        if user is None or not user.is_active:
            raise UnauthorizedError("Invalid or expired extension code.")
        logger.info("auth.extension_code_redeemed", user_id=str(user.id))
        return await self._issue_tokens(user)

    async def purge_extension_codes(self) -> int:
        """Delete extension codes issued more than a day ago (expired or used)."""
        deleted = await self.codes.purge_created_before(utcnow() - EXTENSION_CODE_RETENTION)
        await self.codes.commit()
        return deleted

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
    users: UserRepositoryDep,
    tokens: RefreshTokenRepositoryDep,
    codes: ExtensionCodeRepositoryDep,
    settings: SettingsDep,
) -> AuthService:
    return AuthService(users, tokens, codes, settings)


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
