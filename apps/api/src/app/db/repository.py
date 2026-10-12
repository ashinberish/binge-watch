"""Shared repository base: thin wrapper around a request-scoped ``AsyncSession``."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import Base


class SQLAlchemyRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def add(self, instance: Base) -> None:
        self.session.add(instance)

    async def delete(self, instance: Base) -> None:
        await self.session.delete(instance)

    async def flush(self) -> None:
        await self.session.flush()

    async def commit(self) -> None:
        await self.session.commit()

    async def rollback(self) -> None:
        await self.session.rollback()

    async def refresh(self, instance: Base) -> None:
        await self.session.refresh(instance)
