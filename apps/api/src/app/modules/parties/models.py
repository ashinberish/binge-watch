import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.modules.users.models import User


class Party(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A watch party: several viewers keeping one video in sync.

    Playback state lives in the realtime hub (Redis or memory), not here; this row owns
    identity, the invite code, membership and lifetime.
    """

    __tablename__ = "parties"

    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    host_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(32))
    watch_url: Mapped[str] = mapped_column(String(2048))
    episode_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("episodes.id", ondelete="SET NULL"), index=True, default=None
    )
    expires_at: Mapped[datetime] = mapped_column(index=True)
    ended_at: Mapped[datetime | None] = mapped_column(default=None)

    host: Mapped[User] = relationship(lazy="raise")

    def is_active(self, now: datetime) -> bool:
        return self.ended_at is None and self.expires_at > now


class PartyMember(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "party_members"
    __table_args__ = (UniqueConstraint("party_id", "user_id"),)

    party_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("parties.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    joined_at: Mapped[datetime] = mapped_column(default=utcnow, server_default=func.now())
