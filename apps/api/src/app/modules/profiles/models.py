import uuid

from sqlalchemy import ForeignKey, String, false
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

DEFAULT_AVATAR_COLOR = "#d32f23"
MAX_PROFILES_PER_USER = 5


class Profile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A viewer profile under an account (household members, kids)."""

    __tablename__ = "profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(30))
    avatar_color: Mapped[str] = mapped_column(
        String(7), default=DEFAULT_AVATAR_COLOR, server_default=DEFAULT_AVATAR_COLOR
    )
    is_kids: Mapped[bool] = mapped_column(default=False, server_default=false())
