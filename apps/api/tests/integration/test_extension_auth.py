"""Chrome extension sign-in: web app issues a one-time code, extension redeems it."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import hash_token
from app.main import create_app
from app.modules.auth.models import ExtensionCode

EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop"
REDIRECT_URI = f"https://{EXTENSION_ID}.chromiumapp.org/callback"


async def issue_code(
    client: httpx.AsyncClient, headers: dict[str, str], redirect_uri: str = REDIRECT_URI
) -> str:
    resp = await client.post(
        "/api/v1/auth/extension-code", json={"redirect_uri": redirect_uri}, headers=headers
    )
    assert resp.status_code == 201, resp.text
    code: str = resp.json()["code"]
    return code


async def test_extension_sign_in_happy_path(
    client: httpx.AsyncClient, auth: dict[str, Any], session: AsyncSession
) -> None:
    resp = await client.post(
        "/api/v1/auth/extension-code",
        json={"redirect_uri": REDIRECT_URI},
        headers=auth["headers"],
    )
    assert resp.status_code == 201
    body = resp.json()
    assert set(body) == {"code", "expires_in"}
    assert body["expires_in"] == 60
    assert len(body["code"]) >= 43  # 32 random bytes, base64url

    # Only the digest is stored.
    stored = (await session.execute(select(ExtensionCode))).scalar_one()
    assert stored.code_hash == hash_token(body["code"])
    assert stored.code_hash != body["code"]
    assert stored.redirect_uri == REDIRECT_URI
    assert stored.used_at is None
    assert stored.expires_at - stored.created_at <= timedelta(seconds=61)

    resp = await client.post(
        "/api/v1/auth/extension-token",
        json={"code": body["code"], "redirect_uri": REDIRECT_URI},
    )
    assert resp.status_code == 200, resp.text
    tokens = resp.json()
    assert set(tokens) == {"access_token", "refresh_token", "token_type", "expires_in"}
    me = await client.get(
        "/api/v1/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}
    )
    assert me.json()["id"] == auth["user"]["id"]

    # The extension's refresh token rotates like any other.
    refreshed = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert refreshed.status_code == 200


async def test_extension_code_is_single_use(
    client: httpx.AsyncClient, auth_headers: dict[str, str]
) -> None:
    code = await issue_code(client, auth_headers)
    payload = {"code": code, "redirect_uri": REDIRECT_URI}
    first = await client.post("/api/v1/auth/extension-token", json=payload)
    assert first.status_code == 200
    again = await client.post("/api/v1/auth/extension-token", json=payload)
    assert again.status_code == 401
    assert again.headers["content-type"] == "application/problem+json"
    assert again.json()["title"] == "Unauthorized"


async def test_extension_code_expires(
    client: httpx.AsyncClient, auth_headers: dict[str, str], session: AsyncSession
) -> None:
    code = await issue_code(client, auth_headers)
    stored = (await session.execute(select(ExtensionCode))).scalar_one()
    stored.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await session.commit()

    resp = await client.post(
        "/api/v1/auth/extension-token", json={"code": code, "redirect_uri": REDIRECT_URI}
    )
    assert resp.status_code == 401


async def test_extension_code_wrong_redirect_uri(
    client: httpx.AsyncClient, auth_headers: dict[str, str]
) -> None:
    code = await issue_code(client, auth_headers)
    other = f"https://{'p' * 32}.chromiumapp.org/callback"
    resp = await client.post(
        "/api/v1/auth/extension-token", json={"code": code, "redirect_uri": other}
    )
    assert resp.status_code == 401
    # A mismatch doesn't burn the code for its legitimate redirect URI.
    resp = await client.post(
        "/api/v1/auth/extension-token", json={"code": code, "redirect_uri": REDIRECT_URI}
    )
    assert resp.status_code == 200


async def test_extension_code_unknown(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/extension-token", json={"code": "nope", "redirect_uri": REDIRECT_URI}
    )
    assert resp.status_code == 401
    assert resp.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "redirect_uri",
    [
        "https://evil.example.com/callback",
        f"http://{EXTENSION_ID}.chromiumapp.org/callback",
        f"https://{EXTENSION_ID}.chromiumapp.org",  # path required
        f"https://{EXTENSION_ID}.chromiumapp.org.evil.com/",
        f"https://{'q' * 32}.chromiumapp.org/",  # extension ids use a-p only
        f"https://{EXTENSION_ID[:31]}.chromiumapp.org/",
        f"https://{EXTENSION_ID}.chromiumapp.org/\nx",
        f"chrome-extension://{EXTENSION_ID}/callback",
        f"xhttps://{EXTENSION_ID}.chromiumapp.org/",
    ],
)
async def test_extension_code_rejects_invalid_redirect_uri(
    client: httpx.AsyncClient, auth_headers: dict[str, str], redirect_uri: str
) -> None:
    resp = await client.post(
        "/api/v1/auth/extension-code", json={"redirect_uri": redirect_uri}, headers=auth_headers
    )
    assert resp.status_code == 422
    assert resp.headers["content-type"] == "application/problem+json"
    assert resp.json()["errors"][0]["loc"] == ["body", "redirect_uri"]


async def test_extension_code_accepts_any_path(
    client: httpx.AsyncClient, auth_headers: dict[str, str]
) -> None:
    await issue_code(client, auth_headers, f"https://{EXTENSION_ID}.chromiumapp.org/")
    await issue_code(client, auth_headers, f"https://{EXTENSION_ID}.chromiumapp.org/a/b?c=d")


async def test_extension_code_requires_auth(client: httpx.AsyncClient) -> None:
    resp = await client.post("/api/v1/auth/extension-code", json={"redirect_uri": REDIRECT_URI})
    assert resp.status_code == 401
    resp = await client.post(
        "/api/v1/auth/extension-code",
        json={"redirect_uri": REDIRECT_URI},
        headers={"Authorization": "Bearer garbage"},
    )
    assert resp.status_code == 401


async def test_extension_token_validates_body(client: httpx.AsyncClient) -> None:
    resp = await client.post("/api/v1/auth/extension-token", json={"code": ""})
    assert resp.status_code == 422


async def test_cors_admits_chrome_extension_origin(settings: Settings) -> None:
    """The documented APP_CORS_ORIGIN_REGEX lets the extension call the API directly."""
    env_example = Path(__file__).parents[2] / ".env.example"
    regex = next(
        line.split("=", 1)[1].strip()
        for line in env_example.read_text().splitlines()
        if line.startswith("APP_CORS_ORIGIN_REGEX=")
    )
    app: FastAPI = create_app(settings.model_copy(update={"cors_origin_regex": regex}))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        origin = f"chrome-extension://{EXTENSION_ID}"
        resp = await ac.options(
            "/api/v1/auth/extension-token",
            headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
        )
        assert resp.headers["access-control-allow-origin"] == origin
        bad = await ac.options(
            "/api/v1/auth/extension-token",
            headers={
                "Origin": f"chrome-extension://{EXTENSION_ID}.evil",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert "access-control-allow-origin" not in bad.headers
    await app.state.engine.dispose()
