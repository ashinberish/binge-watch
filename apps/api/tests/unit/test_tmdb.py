import httpx
import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.integrations.tmdb import TMDBClient, TMDBNotConfiguredError


def handler(request: httpx.Request) -> httpx.Response:
    assert request.headers["Authorization"] == "Bearer tmdb-key"
    if request.url.path.endswith("/search/tv"):
        assert request.url.params["query"] == "night"
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "id": 1,
                        "name": "Night Show",
                        "overview": "o",
                        "poster_path": "/p.jpg",
                        "first_air_date": "2020-05-01",
                    },
                    {"id": 2, "name": "No Poster", "first_air_date": ""},
                ]
            },
        )
    return httpx.Response(200, json={"id": 7, "name": "Seven", "overview": "x"})


async def test_tmdb_client() -> None:
    settings = Settings(tmdb_api_key=SecretStr("tmdb-key"))
    async with TMDBClient(settings, transport=httpx.MockTransport(handler)) as client:
        results = await client.search_shows("night")
        assert results[0].title == "Night Show"
        assert results[0].year == 2020
        assert results[0].poster_url == "https://image.tmdb.org/t/p/w500/p.jpg"
        assert results[1].poster_url is None
        assert results[1].year is None
        show = await client.get_show(7)
        assert (show.tmdb_id, show.title) == (7, "Seven")


def test_tmdb_requires_key() -> None:
    with pytest.raises(TMDBNotConfiguredError):
        TMDBClient(Settings(tmdb_api_key=None))
