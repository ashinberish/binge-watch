from typing import Any

import httpx


async def test_get_me(client: httpx.AsyncClient, auth: dict[str, Any]) -> None:
    resp = await client.get("/api/v1/users/me", headers=auth["headers"])
    assert resp.status_code == 200
    assert resp.json() == auth["user"]


async def test_get_me_requires_auth(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/v1/users/me")
    assert resp.status_code == 401
    assert resp.headers["content-type"] == "application/problem+json"


async def test_get_me_rejects_bad_token(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/v1/users/me", headers={"Authorization": "Bearer nope"})
    assert resp.status_code == 401


async def test_get_me_rejects_refresh_token(
    client: httpx.AsyncClient, auth: dict[str, Any]
) -> None:
    token = auth["tokens"]["refresh_token"]
    resp = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


async def test_update_me(client: httpx.AsyncClient, auth: dict[str, Any]) -> None:
    resp = await client.patch(
        "/api/v1/users/me", json={"display_name": "Night Owl"}, headers=auth["headers"]
    )
    assert resp.status_code == 200
    assert resp.json()["display_name"] == "Night Owl"

    noop = await client.patch("/api/v1/users/me", json={}, headers=auth["headers"])
    assert noop.status_code == 200
    assert noop.json()["display_name"] == "Night Owl"


async def test_update_me_validation(client: httpx.AsyncClient, auth: dict[str, Any]) -> None:
    resp = await client.patch(
        "/api/v1/users/me", json={"display_name": ""}, headers=auth["headers"]
    )
    assert resp.status_code == 422
