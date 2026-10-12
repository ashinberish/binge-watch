import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Annotated

from fastapi import Depends
from sqlalchemy import func, select, update
from sqlalchemy.orm import joinedload

from app.db.repository import SQLAlchemyRepository
from app.db.session import DbSession
from app.modules.parties.models import Party, PartyMember


class PartyRepository(SQLAlchemyRepository):
    async def get_by_code(self, code: str, *, for_update: bool = False) -> Party | None:
        """The party with ``code`` and its host loaded. ``for_update`` locks the row
        (PostgreSQL; a no-op on SQLite) to serialise joins against the member limit."""
        stmt = (
            select(Party).options(joinedload(Party.host, innerjoin=True)).where(Party.code == code)
        )
        if for_update:
            stmt = stmt.with_for_update(of=Party)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get(self, party_id: uuid.UUID) -> Party | None:
        result = await self.session.execute(
            select(Party)
            .options(joinedload(Party.host, innerjoin=True))
            .where(Party.id == party_id)
        )
        return result.scalar_one_or_none()

    async def code_exists(self, code: str) -> bool:
        result = await self.session.execute(select(Party.id).where(Party.code == code))
        return result.first() is not None

    async def get_member(self, party_id: uuid.UUID, user_id: uuid.UUID) -> PartyMember | None:
        result = await self.session.execute(
            select(PartyMember).where(
                PartyMember.party_id == party_id, PartyMember.user_id == user_id
            )
        )
        return result.scalar_one_or_none()

    async def count_members(self, party_id: uuid.UUID) -> int:
        result = await self.session.execute(
            select(func.count()).select_from(PartyMember).where(PartyMember.party_id == party_id)
        )
        return int(result.scalar_one())

    async def list_expired_open(self, now: datetime, *, limit: int = 500) -> Sequence[Party]:
        result = await self.session.execute(
            select(Party)
            .where(Party.ended_at.is_(None), Party.expires_at <= now)
            .order_by(Party.expires_at)
            .limit(limit)
        )
        return result.scalars().all()

    async def mark_ended(self, party_ids: Sequence[uuid.UUID], at: datetime) -> None:
        if not party_ids:
            return
        await self.session.execute(
            update(Party)
            .where(Party.id.in_(party_ids), Party.ended_at.is_(None))
            .values(ended_at=at)
            .execution_options(synchronize_session=False)
        )


def get_party_repository(session: DbSession) -> PartyRepository:
    return PartyRepository(session)


PartyRepositoryDep = Annotated[PartyRepository, Depends(get_party_repository)]
