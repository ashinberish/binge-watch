"""TMDB (The Movie Database) client — interface for future catalog ingestion.

Not wired into any request path yet. A background task will use it to import
show metadata into the local catalog.
"""

from dataclasses import dataclass
from typing import Any, Protocol, Self

import httpx

from app.core.config import Settings

POSTER_BASE_URL = "https://image.tmdb.org/t/p/w500"


@dataclass(frozen=True, slots=True)
class ExternalShow:
    tmdb_id: int
    title: str
    synopsis: str
    poster_url: str | None
    year: int | None


class CatalogProvider(Protocol):
    async def search_shows(self, query: str) -> list[ExternalShow]: ...

    async def get_show(self, tmdb_id: int) -> ExternalShow: ...


class TMDBNotConfiguredError(RuntimeError):
    pass


def _to_show(data: dict[str, Any]) -> ExternalShow:
    first_air = str(data.get("first_air_date") or "")
    poster = data.get("poster_path")
    return ExternalShow(
        tmdb_id=int(data["id"]),
        title=str(data.get("name") or data.get("title") or ""),
        synopsis=str(data.get("overview") or ""),
        poster_url=f"{POSTER_BASE_URL}{poster}" if poster else None,
        year=int(first_air[:4]) if first_air[:4].isdigit() else None,
    )


class TMDBClient:
    """Async TMDB v3 client implementing :class:`CatalogProvider`."""

    def __init__(self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None):
        if settings.tmdb_api_key is None:
            raise TMDBNotConfiguredError("APP_TMDB_API_KEY is not set")
        self._client = httpx.AsyncClient(
            base_url=settings.tmdb_base_url,
            headers={"Authorization": f"Bearer {settings.tmdb_api_key.get_secret_value()}"},
            timeout=httpx.Timeout(10.0),
            transport=transport,
        )

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def search_shows(self, query: str) -> list[ExternalShow]:
        response = await self._client.get("/search/tv", params={"query": query})
        response.raise_for_status()
        return [_to_show(item) for item in response.json().get("results", [])]

    async def get_show(self, tmdb_id: int) -> ExternalShow:
        response = await self._client.get(f"/tv/{tmdb_id}")
        response.raise_for_status()
        return _to_show(response.json())
