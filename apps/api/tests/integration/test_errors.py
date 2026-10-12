import httpx
from fastapi import FastAPI


async def test_unknown_route_is_problem_json(client: httpx.AsyncClient) -> None:
    resp = await client.get("/nope")
    assert resp.status_code == 404
    assert resp.headers["content-type"] == "application/problem+json"
    body = resp.json()
    assert body["type"] == "about:blank"
    assert body["title"] == "Not Found"
    assert body["status"] == 404
    assert body["instance"] == "/nope"


async def test_method_not_allowed(client: httpx.AsyncClient) -> None:
    resp = await client.delete("/health/live")
    assert resp.status_code == 405
    assert resp.json()["title"] == "Method Not Allowed"


async def test_validation_error_shape(client: httpx.AsyncClient) -> None:
    resp = await client.post("/api/v1/auth/register", json={"email": "bad"})
    assert resp.status_code == 422
    assert resp.headers["content-type"] == "application/problem+json"
    body = resp.json()
    assert body["type"].endswith("/validation-error")
    assert body["status"] == 422
    locs = {tuple(err["loc"]) for err in body["errors"]}
    assert ("body", "email") in locs
    assert ("body", "password") in locs


async def test_request_id_is_generated_and_echoed(client: httpx.AsyncClient) -> None:
    resp = await client.get("/health/live")
    assert len(resp.headers["x-request-id"]) == 32

    resp = await client.get("/health/live", headers={"X-Request-ID": "trace-abc.123"})
    assert resp.headers["x-request-id"] == "trace-abc.123"

    resp = await client.get("/health/live", headers={"X-Request-ID": "bad id with spaces"})
    assert resp.headers["x-request-id"] != "bad id with spaces"


async def test_cors_preflight(client: httpx.AsyncClient) -> None:
    resp = await client.options(
        "/api/v1/users/me",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"


async def test_unhandled_exception_returns_500_problem(app: FastAPI) -> None:
    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("kaboom")

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/boom")
    assert resp.status_code == 500
    assert resp.headers["content-type"] == "application/problem+json"
    body = resp.json()
    assert body["detail"] == "An unexpected error occurred."
    assert "kaboom" not in resp.text
