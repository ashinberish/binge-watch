import uuid

from sqlalchemy import ForeignKey, Index, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class WatchProgress(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Latest playback position of one episode for one profile."""

    __tablename__ = "watch_progress"
    __table_args__ = (
        UniqueConstraint("profile_id", "episode_id"),
        Index(
            "ix_watch_progress_profile_completed_updated", "profile_id", "completed", "updated_at"
        ),
    )

    # Indexed via the composite index / unique constraint, both led by profile_id.
    profile_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"))
    episode_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("episodes.id", ondelete="CASCADE"), index=True
    )
    position_seconds: Mapped[int]
    duration_seconds: Mapped[int]
    completed: Mapped[bool] = mapped_column(default=False, server_default=false())
