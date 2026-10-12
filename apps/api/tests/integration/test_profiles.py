from typing import Any

import httpx


async def test_profile_crud(client: httpx.AsyncClient, auth_headers: dict[str, str]) -> None:
    resp = await client.get("/api/v1/profiles", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []

    resp = await client.post("/api/v1/profiles", json={"name": "Kids"}, headers=auth_headers)
    assert resp.status_code == 201
    created = resp.json()
    assert set(created) == {"id", "name", "avatar_color", "is_kids", "created_at"}
    assert created["avatar_color"] == "#d32f23"
    assert created["is_kids"] is False

    resp = await client.patch(
        f"/api/v1/profiles/{created['id']}",
        json={"is_kids": True, "avatar_color": "#00AAFF"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["is_kids"] is True
    assert resp.json()["avatar_color"] == "#00AAFF"
    assert resp.json()["name"] == "Kids"

    resp = await client.get("/api/v1/profiles", headers=auth_headers)
    assert [p["id"] for p in resp.json()] == [created["id"]]

    resp = await client.delete(f"/api/v1/profiles/{created['id']}", headers=auth_headers)
    assert resp.status_code == 204
    resp = await client.get("/api/v1/profiles", headers=auth_headers)
    assert resp.json() == []


async def test_profile_limit(client: httpx.AsyncClient, auth_headers: dict[str, str]) -> None:
    for i in range(5):
        resp = await client.post("/api/v1/profiles", json={"name": f"P{i}"}, headers=auth_headers)
        assert resp.status_code == 201
    resp = await client.post("/api/v1/profiles", json={"name": "P6"}, headers=auth_headers)
    assert resp.status_code == 409


async def test_profile_validation(client: httpx.AsyncClient, auth_headers: dict[str, str]) -> None:
    resp = await client.post(
        "/api/v1/profiles", json={"name": "X", "avatar_color": "red"}, headers=auth_headers
    )
    assert resp.status_code == 422


async def test_profiles_of_other_users_are_404(
    client: httpx.AsyncClient, profile: dict[str, Any], other_auth: dict[str, Any]
) -> None:
    url = f"/api/v1/profiles/{profile['id']}"
    resp = await client.patch(url, json={"name": "Mine"}, headers=other_auth["headers"])
    assert resp.status_code == 404
    resp = await client.delete(url, headers=other_auth["headers"])
    assert resp.status_code == 404
    resp = await client.get("/api/v1/profiles", headers=other_auth["headers"])
    assert resp.json() == []


async def test_unknown_profile_is_404(
    client: httpx.AsyncClient, auth_headers: dict[str, str]
) -> None:
    resp = await client.delete(
        "/api/v1/profiles/00000000-0000-0000-0000-000000000000", headers=auth_headers
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Profile not found."
