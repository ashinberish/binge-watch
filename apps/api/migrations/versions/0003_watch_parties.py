"""Watch parties and their members.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-12 00:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
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
        "parties",
        _pk(),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("host_user_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("watch_url", sa.String(length=2048), nullable=False),
        sa.Column("episode_id", sa.Uuid(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["host_user_id"],
            ["users.id"],
            name=op.f("fk_parties_host_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["episode_id"],
            ["episodes.id"],
            name=op.f("fk_parties_episode_id_episodes"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_parties")),
    )
    op.create_index(op.f("ix_parties_code"), "parties", ["code"], unique=True)
    op.create_index(op.f("ix_parties_host_user_id"), "parties", ["host_user_id"])
    op.create_index(op.f("ix_parties_episode_id"), "parties", ["episode_id"])
    op.create_index(op.f("ix_parties_expires_at"), "parties", ["expires_at"])

    op.create_table(
        "party_members",
        _pk(),
        sa.Column("party_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["party_id"],
            ["parties.id"],
            name=op.f("fk_party_members_party_id_parties"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_party_members_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_party_members")),
        sa.UniqueConstraint(
            "party_id", "user_id", name=op.f("uq_party_members_party_id_user_id")
        ),
    )
    op.create_index(op.f("ix_party_members_party_id"), "party_members", ["party_id"])
    op.create_index(op.f("ix_party_members_user_id"), "party_members", ["user_id"])


def downgrade() -> None:
    op.drop_table("party_members")
    op.drop_table("parties")
