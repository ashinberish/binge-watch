from typing import Any

import httpx

from tests.conftest import PASSWORD


async def test_register_returns_user(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "New@Example.com", "password": PASSWORD, "display_name": "  Neo  "},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert set(body) == {"id", "email", "display_name", "created_at"}
    assert body["email"] == "new@example.com"
    assert body["display_name"] == "Neo"


async def test_register_duplicate_email_conflicts(
    client: httpx.AsyncClient, auth: dict[str, Any]
) -> None:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "VIEWER@example.com", "password": PASSWORD, "display_name": "Dup"},
    )
    assert resp.status_code == 409
    assert resp.headers["content-type"] == "application/problem+json"
    assert resp.json()["title"] == "Conflict"


async def test_register_short_password_rejected(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "a@example.com", "password": "short", "display_name": "A"},
    )
    assert resp.status_code == 422


async def test_login_returns_token_pair(auth: dict[str, Any]) -> None:
    tokens = auth["tokens"]
    assert set(tokens) == {"access_token", "refresh_token", "token_type", "expires_in"}
    assert tokens["token_type"] == "bearer"
    assert tokens["expires_in"] == 900


async def test_login_wrong_password(client: httpx.AsyncClient, auth: dict[str, Any]) -> None:
    resp = await client.post(
        "/api/v1/auth/login", json={"email": "viewer@example.com", "password": "wrong-password"}
    )
    assert resp.status_code == 401
    assert resp.headers["www-authenticate"] == "Bearer"


async def test_login_unknown_email(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/login", json={"email": "ghost@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 401


async def test_refresh_rotates_tokens(client: httpx.AsyncClient, auth: dict[str, Any]) -> None:
    old_refresh = auth["tokens"]["refresh_token"]
    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
    assert resp.status_code == 200
    new_tokens = resp.json()
    assert new_tokens["refresh_token"] != old_refresh

    # The new access token works.
    me = await client.get(
        "/api/v1/users/me", headers={"Authorization": f"Bearer {new_tokens['access_token']}"}
    )
    assert me.status_code == 200

    # Re-using the rotated token fails and revokes the whole family.
    reuse = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
    assert reuse.status_code == 401
    family = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": new_tokens["refresh_token"]}
    )
    assert family.status_code == 401


async def test_refresh_rejects_garbage_and_access_tokens(
    client: httpx.AsyncClient, auth: dict[str, Any]
) -> None:
    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": "not-a-jwt"})
    assert resp.status_code == 401
    resp = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": auth["tokens"]["access_token"]}
    )
    assert resp.status_code == 401


async def test_logout_revokes_refresh_token(
    client: httpx.AsyncClient, auth: dict[str, Any]
) -> None:
    refresh = auth["tokens"]["refresh_token"]
    resp = await client.post("/api/v1/auth/logout", json={"refresh_token": refresh})
    assert resp.status_code == 204
    assert resp.content == b""

    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert resp.status_code == 401

    # Idempotent, and unknown tokens don't leak anything.
    again = await client.post("/api/v1/auth/logout", json={"refresh_token": refresh})
    assert again.status_code == 204
    unknown = await client.post("/api/v1/auth/logout", json={"refresh_token": "whatever"})
    assert unknown.status_code == 204
