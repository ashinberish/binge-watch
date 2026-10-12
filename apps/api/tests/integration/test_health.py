import httpx
from fastapi import FastAPI


async def test_live(client: httpx.AsyncClient) -> None:
    resp = await client.get("/health/live")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_ready(client: httpx.AsyncClient) -> None:
    resp = await client.get("/health/ready")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "checks": {"database": "ok"}}


async def test_ready_returns_503_when_database_down(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    class BrokenSession:
        async def execute(self, *_args: object) -> None:
            raise ConnectionError("db down")

        async def __aenter__(self) -> "BrokenSession":
            return self

        async def __aexit__(self, *_exc: object) -> None:
            return None

        async def rollback(self) -> None:
            return None

    app.state.sessionmaker = BrokenSession
    resp = await client.get("/health/ready")
    assert resp.status_code == 503
    assert resp.headers["content-type"] == "application/problem+json"
    body = resp.json()
    assert body["status"] == 503
    assert body["title"] == "Service Unavailable"
