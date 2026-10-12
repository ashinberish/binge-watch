import uuid
from datetime import datetime
from typing import Annotated, Any, cast

from fastapi import Depends
from sqlalchemy import CursorResult, delete, select, update

from app.db.repository import SQLAlchemyRepository
from app.db.session import DbSession
from app.modules.auth.models import ExtensionCode, RefreshToken


class RefreshTokenRepository(SQLAlchemyRepository):
    async def get_by_hash(self, token_hash: str) -> RefreshToken | None:
        result = await self.session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        return result.scalar_one_or_none()

    async def revoke_all_for_user(self, user_id: uuid.UUID, at: datetime) -> None:
        await self.session.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=at)
        )


class ExtensionCodeRepository(SQLAlchemyRepository):
    async def get_by_hash(self, code_hash: str) -> ExtensionCode | None:
        result = await self.session.execute(
            select(ExtensionCode).where(ExtensionCode.code_hash == code_hash)
        )
        return result.scalar_one_or_none()

    async def claim(self, code_id: uuid.UUID, at: datetime) -> bool:
        """Mark a code used in one conditional UPDATE. False if it was already used/expired.

        Concurrent exchanges of the same code race on this statement; only one sees a
        matched row, so a code can never yield two token pairs.
        """
        result = cast(
            CursorResult[Any],
            await self.session.execute(
                update(ExtensionCode)
                .where(
                    ExtensionCode.id == code_id,
                    ExtensionCode.used_at.is_(None),
                    ExtensionCode.expires_at > at,
                )
                .values(used_at=at)
                .execution_options(synchronize_session=False)
            ),
        )
        return result.rowcount == 1

    async def purge_created_before(self, cutoff: datetime) -> int:
        """Delete codes issued before ``cutoff`` (all long expired). Returns the count."""
        result = cast(
            CursorResult[Any],
            await self.session.execute(
                delete(ExtensionCode)
                .where(ExtensionCode.created_at < cutoff)
                .execution_options(synchronize_session=False)
            ),
        )
        return result.rowcount


def get_refresh_token_repository(session: DbSession) -> RefreshTokenRepository:
    return RefreshTokenRepository(session)


def get_extension_code_repository(session: DbSession) -> ExtensionCodeRepository:
    return ExtensionCodeRepository(session)


RefreshTokenRepositoryDep = Annotated[RefreshTokenRepository, Depends(get_refresh_token_repository)]
ExtensionCodeRepositoryDep = Annotated[
    ExtensionCodeRepository, Depends(get_extension_code_repository)
]
