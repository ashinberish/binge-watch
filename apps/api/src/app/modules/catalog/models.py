import uuid

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Show(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "shows"

    title: Mapped[str] = mapped_column(String(255), index=True)
    synopsis: Mapped[str] = mapped_column(Text, default="", server_default="")
    poster_url: Mapped[str | None] = mapped_column(String(1024), default=None)
    year: Mapped[int | None] = mapped_column(Integer, default=None)
    tmdb_id: Mapped[int | None] = mapped_column(Integer, unique=True, default=None)

    seasons: Mapped[list["Season"]] = relationship(
        back_populates="show",
        order_by="Season.number",
        cascade="all, delete-orphan",
        lazy="raise",
    )


class Season(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "seasons"
    __table_args__ = (UniqueConstraint("show_id", "number"),)

    show_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("shows.id", ondelete="CASCADE"), index=True
    )
    number: Mapped[int]

    show: Mapped[Show] = relationship(back_populates="seasons", lazy="raise")
    episodes: Mapped[list["Episode"]] = relationship(
        back_populates="season",
        order_by="Episode.number",
        cascade="all, delete-orphan",
        lazy="raise",
    )


class Episode(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "episodes"
    __table_args__ = (UniqueConstraint("season_id", "number"),)

    season_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("seasons.id", ondelete="CASCADE"), index=True
    )
    number: Mapped[int]
    title: Mapped[str] = mapped_column(String(255))
    duration_seconds: Mapped[int]

    season: Mapped[Season] = relationship(back_populates="episodes", lazy="raise")


class EpisodeExternalId(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Maps a streaming provider's own episode id (e.g. a Netflix watch id) to our episode."""

    __tablename__ = "episode_external_ids"
    __table_args__ = (UniqueConstraint("provider", "external_id"),)

    provider: Mapped[str] = mapped_column(String(32))
    external_id: Mapped[str] = mapped_column(String(255))
    episode_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("episodes.id", ondelete="CASCADE"), index=True
    )
