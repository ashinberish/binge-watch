import httpx

from app.modules.catalog.models import Show


async def test_list_shows(
    client: httpx.AsyncClient, auth_headers: dict[str, str], shows: list[Show]
) -> None:
    resp = await client.get("/api/v1/catalog/shows", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert [s["title"] for s in body] == [
        "Saltwater Kingdoms",
        "Signal & Noise",
        "The Midnight Archive",
    ]
    assert set(body[0]) == {"id", "title", "synopsis", "poster_url", "year"}


async def test_list_shows_search_and_paging(
    client: httpx.AsyncClient, auth_headers: dict[str, str], shows: list[Show]
) -> None:
    resp = await client.get("/api/v1/catalog/shows", params={"q": "midnight"}, headers=auth_headers)
    assert [s["title"] for s in resp.json()] == ["The Midnight Archive"]

    resp = await client.get("/api/v1/catalog/shows", params={"q": "%"}, headers=auth_headers)
    assert resp.json() == []

    resp = await client.get(
        "/api/v1/catalog/shows", params={"limit": 1, "offset": 1}, headers=auth_headers
    )
    assert [s["title"] for s in resp.json()] == ["Signal & Noise"]

    resp = await client.get("/api/v1/catalog/shows", params={"limit": 0}, headers=auth_headers)
    assert resp.status_code == 422


async def test_list_shows_requires_auth(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/v1/catalog/shows")
    assert resp.status_code == 401


async def test_get_show_detail(
    client: httpx.AsyncClient, auth_headers: dict[str, str], shows: list[Show]
) -> None:
    show = next(s for s in shows if s.title == "Signal & Noise")
    resp = await client.get(f"/api/v1/catalog/shows/{show.id}", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Signal & Noise"
    assert [s["number"] for s in body["seasons"]] == [1, 2]
    first = body["seasons"][0]
    assert set(first) == {"id", "number", "episodes"}
    assert [e["number"] for e in first["episodes"]] == [1, 2, 3]
    assert set(first["episodes"][0]) == {"id", "number", "title", "duration_seconds"}


async def test_get_show_not_found(client: httpx.AsyncClient, auth_headers: dict[str, str]) -> None:
    resp = await client.get(
        "/api/v1/catalog/shows/00000000-0000-0000-0000-000000000000", headers=auth_headers
    )
    assert resp.status_code == 404


async def test_get_show_invalid_uuid(
    client: httpx.AsyncClient, auth_headers: dict[str, str]
) -> None:
    resp = await client.get("/api/v1/catalog/shows/not-a-uuid", headers=auth_headers)
    assert resp.status_code == 422
