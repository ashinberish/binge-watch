import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class RefreshToken(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A refresh token issued to a user. Only the SHA-256 digest is stored."""

    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None] = mapped_column(default=None)

    @property
    def is_revoked(self) -> bool:
        return self.revoked_at is not None


class ExtensionCode(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Short-lived, single-use code that hands a web session over to the Chrome extension.

    Only the SHA-256 digest of the code is stored. The code is bound to the extension
    redirect URI it was issued for.
    """

    __tablename__ = "extension_codes"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    redirect_uri: Mapped[str] = mapped_column(String(2048))
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None] = mapped_column(default=None)

    @property
    def is_used(self) -> bool:
        return self.used_at is not None
