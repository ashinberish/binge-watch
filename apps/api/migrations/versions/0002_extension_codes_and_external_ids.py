"""Extension sign-in codes and provider episode id mappings.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-12 00:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
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
        "extension_codes",
        _pk(),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("redirect_uri", sa.String(length=2048), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_extension_codes_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_extension_codes")),
    )
    op.create_index(
        op.f("ix_extension_codes_code_hash"), "extension_codes", ["code_hash"], unique=True
    )
    op.create_index(op.f("ix_extension_codes_user_id"), "extension_codes", ["user_id"])

    op.create_table(
        "episode_external_ids",
        _pk(),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("episode_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["episode_id"],
            ["episodes.id"],
            name=op.f("fk_episode_external_ids_episode_id_episodes"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_episode_external_ids")),
        sa.UniqueConstraint(
            "provider",
            "external_id",
            name=op.f("uq_episode_external_ids_provider_external_id"),
        ),
    )
    op.create_index(
        op.f("ix_episode_external_ids_episode_id"), "episode_external_ids", ["episode_id"]
    )


def downgrade() -> None:
    op.drop_table("episode_external_ids")
    op.drop_table("extension_codes")
