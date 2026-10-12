import uuid
from datetime import date

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Streak(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Binge streak per profile. Days are UTC calendar days with >= 1 completed episode."""

    __tablename__ = "streaks"

    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), unique=True, index=True
    )
    current_days: Mapped[int] = mapped_column(default=0, server_default="0")
    longest_days: Mapped[int] = mapped_column(default=0, server_default="0")
    episodes_today: Mapped[int] = mapped_column(default=0, server_default="0")
    last_active_date: Mapped[date | None] = mapped_column(default=None)
