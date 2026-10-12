"""Initial schema: users, auth, profiles, catalog, watch history, streaks.

Revision ID: 0001
Revises:
Create Date: 2026-10-12 00:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _pk() -> sa.Column[object]:
    return sa.Column("id", sa.Uuid(), nullable=False)


def _timestamps() -> list[sa.Column[object]]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "users",
        _pk(),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=50), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "refresh_tokens",
        _pk(),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_refresh_tokens_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_refresh_tokens")),
    )
    op.create_index(
        op.f("ix_refresh_tokens_token_hash"), "refresh_tokens", ["token_hash"], unique=True
    )
    op.create_index(op.f("ix_refresh_tokens_user_id"), "refresh_tokens", ["user_id"])

    op.create_table(
        "profiles",
        _pk(),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=30), nullable=False),
        sa.Column("avatar_color", sa.String(length=7), server_default="#d32f23", nullable=False),
        sa.Column("is_kids", sa.Boolean(), server_default=sa.false(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_profiles_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_profiles")),
    )
    op.create_index(op.f("ix_profiles_user_id"), "profiles", ["user_id"])

    op.create_table(
        "shows",
        _pk(),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("synopsis", sa.Text(), server_default="", nullable=False),
        sa.Column("poster_url", sa.String(length=1024), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("tmdb_id", sa.Integer(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shows")),
        sa.UniqueConstraint("tmdb_id", name=op.f("uq_shows_tmdb_id")),
    )
    op.create_index(op.f("ix_shows_title"), "shows", ["title"])

    op.create_table(
        "seasons",
        _pk(),
        sa.Column("show_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["show_id"], ["shows.id"], name=op.f("fk_seasons_show_id_shows"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_seasons")),
        sa.UniqueConstraint("show_id", "number", name=op.f("uq_seasons_show_id_number")),
    )
    op.create_index(op.f("ix_seasons_show_id"), "seasons", ["show_id"])

    op.create_table(
        "episodes",
        _pk(),
        sa.Column("season_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["season_id"],
            ["seasons.id"],
            name=op.f("fk_episodes_season_id_seasons"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_episodes")),
        sa.UniqueConstraint("season_id", "number", name=op.f("uq_episodes_season_id_number")),
    )
    op.create_index(op.f("ix_episodes_season_id"), "episodes", ["season_id"])

    op.create_table(
        "watch_progress",
        _pk(),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("episode_id", sa.Uuid(), nullable=False),
        sa.Column("position_seconds", sa.Integer(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("completed", sa.Boolean(), server_default=sa.false(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["episode_id"],
            ["episodes.id"],
            name=op.f("fk_watch_progress_episode_id_episodes"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["profiles.id"],
            name=op.f("fk_watch_progress_profile_id_profiles"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_watch_progress")),
        sa.UniqueConstraint(
            "profile_id", "episode_id", name=op.f("uq_watch_progress_profile_id_episode_id")
        ),
    )
    op.create_index(op.f("ix_watch_progress_episode_id"), "watch_progress", ["episode_id"])
    op.create_index(
        "ix_watch_progress_profile_completed_updated",
        "watch_progress",
        ["profile_id", "completed", "updated_at"],
    )

    op.create_table(
        "streaks",
        _pk(),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("current_days", sa.Integer(), server_default="0", nullable=False),
        sa.Column("longest_days", sa.Integer(), server_default="0", nullable=False),
        sa.Column("episodes_today", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_active_date", sa.Date(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["profiles.id"],
            name=op.f("fk_streaks_profile_id_profiles"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_streaks")),
    )
    op.create_index(op.f("ix_streaks_profile_id"), "streaks", ["profile_id"], unique=True)


def downgrade() -> None:
    op.drop_table("streaks")
    op.drop_table("watch_progress")
    op.drop_table("episodes")
    op.drop_table("seasons")
    op.drop_table("shows")
    op.drop_table("profiles")
    op.drop_table("refresh_tokens")
    op.drop_table("users")
