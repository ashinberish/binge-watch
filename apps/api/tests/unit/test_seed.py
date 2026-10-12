from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.catalog.repository import CatalogRepository
from app.scripts.seed import DEMO_SHOWS, seed


async def test_seed_is_idempotent(session: AsyncSession) -> None:
    assert await seed(session) == len(DEMO_SHOWS) == 3
    assert await seed(session) == 0
    shows = await CatalogRepository(session).list_shows(query=None, limit=10, offset=0)
    assert len(shows) == 3
