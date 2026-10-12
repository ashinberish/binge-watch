"""Insert demo shows (idempotent by title).

Usage: ``python -m app.scripts.seed``
"""

import asyncio
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import create_engine, create_sessionmaker
from app.modules.catalog.models import Episode, Season, Show
from app.modules.catalog.repository import CatalogRepository


@dataclass(frozen=True)
class DemoShow:
    title: str
    synopsis: str
    year: int
    poster_url: str | None
    seasons: list[list[tuple[str, int]]]


DEMO_SHOWS: list[DemoShow] = [
    DemoShow(
        title="The Midnight Archive",
        synopsis="A night-shift librarian discovers that overdue books return with memories "
        "that were never written down.",
        year=2023,
        poster_url=None,
        seasons=[
            [("Late Return", 2820), ("Marginalia", 2700), ("The Stacks", 2950)],
            [("Restricted Section", 3010), ("Dust Jacket", 2880)],
        ],
    ),
    DemoShow(
        title="Saltwater Kingdoms",
        synopsis="Rival fishing dynasties fight over a coastline that is slowly disappearing.",
        year=2021,
        poster_url=None,
        seasons=[
            [("High Tide", 3300), ("Undertow", 3240), ("Breakwater", 3420), ("Riptide", 3180)],
        ],
    ),
    DemoShow(
        title="Signal & Noise",
        synopsis="A pirate-radio crew in a 1980s border town broadcasts the truth one "
        "frequency at a time.",
        year=2024,
        poster_url=None,
        seasons=[
            [("Dead Air", 1560), ("Feedback", 1500), ("Static", 1620)],
            [("Frequency", 1580), ("Interference", 1540), ("Sign Off", 1700)],
        ],
    ),
]


async def seed(session: AsyncSession) -> int:
    """Insert missing demo shows; returns how many were created."""
    catalog = CatalogRepository(session)
    created = 0
    for demo in DEMO_SHOWS:
        if await catalog.get_show_by_title(demo.title) is not None:
            continue
        show = Show(
            title=demo.title,
            synopsis=demo.synopsis,
            year=demo.year,
            poster_url=demo.poster_url,
            seasons=[
                Season(
                    number=season_index,
                    episodes=[
                        Episode(number=ep_index, title=title, duration_seconds=duration)
                        for ep_index, (title, duration) in enumerate(episodes, start=1)
                    ],
                )
                for season_index, episodes in enumerate(demo.seasons, start=1)
            ],
        )
        catalog.add(show)
        created += 1
    await catalog.commit()
    return created


async def _main() -> None:
    engine = create_engine(get_settings())
    try:
        async with create_sessionmaker(engine)() as session:
            created = await seed(session)
        print(f"Seeded {created} show(s).")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(_main())
