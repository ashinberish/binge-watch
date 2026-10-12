"""Watch-party WebSocket protocol, driven through Starlette's TestClient.

These tests are synchronous: the TestClient runs the app (lifespan included) on its own
event loop, so the schema is created with a sync engine and every HTTP call goes through
the same TestClient.
"""

import time
from collections.abc import Iterator
from contextlib import AbstractContextManager
from datetime import timedelta
from typing import Any

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession
from starlette.websockets import WebSocketDisconnect

from app.core.config import Settings
from app.core.time import utcnow
from app.db.models import Base
from app.main import create_app
from app.modules.parties import realtime
from app.modules.parties.models import Party
from tests.conftest import PASSWORD

WATCH_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"


@pytest.fixture
def sync_db_url(settings: Settings) -> str:
    return settings.database_url.replace("sqlite+aiosqlite", "sqlite")


@pytest.fixture
def tc(settings: Settings, sync_db_url: str) -> Iterator[TestClient]:
    engine = sa.create_engine(sync_db_url)
    Base.metadata.create_all(engine)
    engine.dispose()
    with TestClient(create_app(settings)) as client:
        yield client


def signup(tc: TestClient, email: str, name: str) -> dict[str, Any]:
    resp = tc.post(
        "/api/v1/auth/register",
        json={"email": email, "password": PASSWORD, "display_name": name},
    )
    assert resp.status_code == 201, resp.text
    user = resp.json()
    tokens = tc.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}).json()
    return {
        "user": user,
        "token": tokens["access_token"],
        "headers": {"Authorization": f"Bearer {tokens['access_token']}"},
    }


@pytest.fixture
def alice(tc: TestClient) -> dict[str, Any]:
    return signup(tc, "alice@example.com", "Alice")


@pytest.fixture
def bob(tc: TestClient) -> dict[str, Any]:
    return signup(tc, "bob@example.com", "Bob")


@pytest.fixture
def code(tc: TestClient, alice: dict[str, Any], bob: dict[str, Any]) -> str:
    """A party hosted by Alice that Bob has joined."""
    resp = tc.post(
        "/api/v1/parties",
        json={"provider": "youtube", "watch_url": WATCH_URL},
        headers=alice["headers"],
    )
    assert resp.status_code == 201, resp.text
    party_code: str = resp.json()["code"]
    resp = tc.post(f"/api/v1/parties/{party_code}/join", headers=bob["headers"])
    assert resp.status_code == 200
    return party_code


def ws_connect(
    tc: TestClient, code: str, origin: str | None = None
) -> AbstractContextManager[WebSocketTestSession]:
    headers = {"origin": origin} if origin else {}
    return tc.websocket_connect(f"/api/v1/parties/{code}/ws", headers=headers)


def authed(ws: WebSocketTestSession, who: dict[str, Any]) -> dict[str, Any]:
    ws.send_json({"type": "auth", "access_token": who["token"]})
    welcome: dict[str, Any] = ws.receive_json()
    assert welcome["type"] == "welcome", welcome
    return welcome


def next_of(ws: WebSocketTestSession, kind: str, limit: int = 20) -> dict[str, Any]:
    """Next message of ``kind``, skipping unrelated ones (e.g. member counts)."""
    for _ in range(limit):
        msg: dict[str, Any] = ws.receive_json()
        if msg["type"] == kind:
            return msg
    raise AssertionError(f"no {kind!r} message within {limit} messages")


def close_code(ws: WebSocketTestSession) -> int:
    for _ in range(20):
        try:
            ws.receive_json()
        except WebSocketDisconnect as exc:
            return exc.code
    raise AssertionError("socket was not closed")


# --- admission ---------------------------------------------------------------------------


def test_welcome(tc: TestClient, code: str, alice: dict[str, Any]) -> None:
    with ws_connect(tc, code, origin="http://localhost:5173") as ws:
        welcome = authed(ws, alice)
    assert welcome == {
        "type": "welcome",
        "state": {
            "paused": True,
            "position": 0.0,
            "rate": 1.0,
            "updated_at": 0.0,
            "seq": 0,
            "by": None,
        },
        "members": 1,
        "you": {"id": alice["user"]["id"], "display_name": "Alice"},
    }


def test_extension_origin_allowed(tc: TestClient, code: str, alice: dict[str, Any]) -> None:
    with ws_connect(tc, code, origin=EXTENSION_ORIGIN) as ws:
        assert authed(ws, alice)["members"] == 1


def test_bad_origin_rejected(tc: TestClient, code: str, alice: dict[str, Any]) -> None:
    with ws_connect(tc, code, origin="https://evil.example") as ws:
        assert close_code(ws) == 4403


@pytest.mark.parametrize(
    "first",
    [
        {"type": "auth", "access_token": "not-a-jwt"},
        {"type": "ping"},
        {"type": "auth"},
        "garbage",
    ],
)
def test_auth_required(tc: TestClient, code: str, first: Any) -> None:
    with ws_connect(tc, code) as ws:
        if isinstance(first, str):
            ws.send_text(first)
        else:
            ws.send_json(first)
        assert close_code(ws) == 4401


def test_refresh_token_is_not_accepted(tc: TestClient, code: str) -> None:
    resp = tc.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
    with ws_connect(tc, code) as ws:
        ws.send_json({"type": "auth", "access_token": resp.json()["refresh_token"]})
        assert close_code(ws) == 4401


def test_auth_timeout(tc: TestClient, code: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(realtime, "AUTH_TIMEOUT_SECONDS", 0.1)
    with ws_connect(tc, code) as ws:
        assert close_code(ws) == 4401


def test_non_member_forbidden(tc: TestClient, code: str) -> None:
    carol = signup(tc, "carol@example.com", "Carol")
    with ws_connect(tc, code) as ws:
        ws.send_json({"type": "auth", "access_token": carol["token"]})
        assert close_code(ws) == 4403


def test_unknown_party(tc: TestClient, alice: dict[str, Any]) -> None:
    with ws_connect(tc, "nosuchcode") as ws:
        ws.send_json({"type": "auth", "access_token": alice["token"]})
        assert close_code(ws) == 4404


def test_expired_party_not_found(
    tc: TestClient, code: str, alice: dict[str, Any], sync_db_url: str
) -> None:
    set_expiry(sync_db_url, code, seconds=-1)
    with ws_connect(tc, code) as ws:
        ws.send_json({"type": "auth", "access_token": alice["token"]})
        assert close_code(ws) == 4404


# --- sync --------------------------------------------------------------------------------


def test_control_broadcasts_to_everyone_in_order(
    tc: TestClient, code: str, alice: dict[str, Any], bob: dict[str, Any]
) -> None:
    with ws_connect(tc, code) as wa, ws_connect(tc, code) as wb:
        authed(wa, alice)
        authed(wb, bob)

        before = time.time()
        wa.send_json({"type": "control", "action": "play", "position": 10.5})
        for ws in (wa, wb):  # sender included
            state = next_of(ws, "state")["state"]
            assert state["seq"] == 1
            assert state["paused"] is False
            assert state["position"] == 10.5
            assert state["rate"] == 1.0
            assert state["by"] == {"id": alice["user"]["id"], "display_name": "Alice"}
            assert before - 1 <= state["updated_at"] <= time.time() + 1

        wb.send_json({"type": "control", "action": "seek", "position": 42, "rate": 1.5})
        for ws in (wa, wb):
            state = next_of(ws, "state")["state"]
            assert (state["seq"], state["paused"], state["position"]) == (2, False, 42.0)
            assert state["rate"] == 1.5
            assert state["by"]["display_name"] == "Bob"

        wa.send_json({"type": "control", "action": "pause", "position": 43})
        for ws in (wa, wb):
            state = next_of(ws, "state")["state"]
            assert (state["seq"], state["paused"], state["rate"]) == (3, True, 1.5)

        wb.send_json({"type": "control", "action": "seek", "position": 5})
        for ws in (wa, wb):
            state = next_of(ws, "state")["state"]
            assert (state["seq"], state["paused"], state["position"]) == (4, True, 5.0)

    # A late joiner gets the current state in its welcome.
    with ws_connect(tc, code) as ws:
        state = authed(ws, bob)["state"]
    assert (state["seq"], state["paused"], state["position"], state["rate"]) == (4, True, 5.0, 1.5)


def test_last_write_wins(
    tc: TestClient, code: str, alice: dict[str, Any], bob: dict[str, Any]
) -> None:
    with ws_connect(tc, code) as wa, ws_connect(tc, code) as wb:
        authed(wa, alice)
        authed(wb, bob)
        wa.send_json({"type": "control", "action": "seek", "position": 100})
        wb.send_json({"type": "control", "action": "seek", "position": 200})

        seen = {
            name: [next_of(ws, "state")["state"] for _ in range(2)]
            for name, ws in (("a", wa), ("b", wb))
        }
    # Both clients see the same totally ordered history; the later write is the state.
    assert seen["a"] == seen["b"]
    assert [s["seq"] for s in seen["a"]] == [1, 2]
    assert {s["position"] for s in seen["a"]} == {100.0, 200.0}
    final = seen["a"][-1]
    assert final["position"] == (100.0 if final["by"]["display_name"] == "Alice" else 200.0)


def test_ping_pong(tc: TestClient, code: str, alice: dict[str, Any]) -> None:
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        before = time.time()
        ws.send_json({"type": "ping"})
        pong = next_of(ws, "pong")
    assert set(pong) == {"type", "server_time"}
    assert before - 1 <= pong["server_time"] <= time.time() + 1


@pytest.mark.parametrize(
    ("frame", "detail"),
    [
        ("not json", "Invalid JSON"),
        ('{"type": "dance"}', "does not match any of the expected tags"),
        ('{"type": "control", "action": "jump", "position": 1}', "control.action"),
        ('{"type": "control", "action": "play", "position": -1}', "control.position"),
        ('{"type": "control", "action": "play", "position": NaN}', "control.position"),
        ('{"type": "control", "action": "play", "position": 1, "rate": 9}', "control.rate"),
        ('{"type": "control", "action": "play"}', "control.position"),
        ('{"type": "auth", "access_token": "again"}', "already authenticated"),
        ("x" * 9000, "message too large"),
    ],
)
def test_malformed_messages_get_errors(
    tc: TestClient, code: str, alice: dict[str, Any], frame: str, detail: str
) -> None:
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        ws.send_text(frame)
        error = next_of(ws, "error")
        assert detail in error["detail"]
        # The connection stays usable.
        ws.send_json({"type": "ping"})
        assert next_of(ws, "pong")["type"] == "pong"


def test_binary_frames_get_errors(tc: TestClient, code: str, alice: dict[str, Any]) -> None:
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        ws.send_bytes(b'{"type": "ping"}')
        assert next_of(ws, "error")["detail"] == "expected a JSON text frame"


def test_controls_are_rate_limited(
    tc: TestClient,
    code: str,
    alice: dict[str, Any],
    bob: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(realtime, "CONTROL_RATE_PER_SECOND", 0.001)
    monkeypatch.setattr(realtime, "CONTROL_BURST", 3.0)
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        for i in range(6):
            ws.send_json({"type": "control", "action": "seek", "position": i})
        ws.send_json({"type": "ping"})
        next_of(ws, "pong")  # every control above has been processed by now
    with ws_connect(tc, code) as ws:
        state = authed(ws, bob)["state"]
    assert (state["seq"], state["position"]) == (3, 2.0)  # excess silently dropped


def test_member_counts(
    tc: TestClient, code: str, alice: dict[str, Any], bob: dict[str, Any]
) -> None:
    with ws_connect(tc, code) as wa:
        assert authed(wa, alice)["members"] == 1
        with ws_connect(tc, code) as wb:
            assert authed(wb, bob)["members"] == 2
            assert next_of(wa, "members") == {"type": "members", "count": 2}
            # A second tab of the same user is not another member.
            with ws_connect(tc, code) as wb2:
                assert authed(wb2, bob)["members"] == 2
                assert next_of(wa, "members") == {"type": "members", "count": 2}
            assert next_of(wa, "members") == {"type": "members", "count": 2}
        assert next_of(wa, "members") == {"type": "members", "count": 1}


def test_idle_connections_are_closed(
    tc: TestClient, code: str, alice: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(realtime, "IDLE_TIMEOUT_SECONDS", 0.2)
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        assert close_code(ws) == 4408


# --- ending ------------------------------------------------------------------------------


def test_party_end_closes_sockets(tc: TestClient, alice: dict[str, Any]) -> None:
    resp = tc.post(
        "/api/v1/parties",
        json={"provider": "youtube", "watch_url": WATCH_URL},
        headers=alice["headers"],
    )
    solo = resp.json()["code"]
    with ws_connect(tc, solo) as ws:
        authed(ws, alice)
        resp = tc.post(f"/api/v1/parties/{solo}/leave", headers=alice["headers"])
        assert resp.status_code == 204
        assert next_of(ws, "ended") == {"type": "ended"}
        assert close_code(ws) == 4410


def test_expiry_closes_sockets(
    tc: TestClient, code: str, alice: dict[str, Any], sync_db_url: str
) -> None:
    set_expiry(sync_db_url, code, seconds=0.5)
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        assert next_of(ws, "ended") == {"type": "ended"}
        assert close_code(ws) == 4410


def test_shutdown_closes_sockets(tc: TestClient, code: str, alice: dict[str, Any]) -> None:
    hub = tc.app.state.party_hub  # type: ignore[attr-defined]
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        tc.portal.call(hub.close)  # type: ignore[union-attr]
        assert close_code(ws) == 1012
    # Connections opened after shutdown began are closed straight away too.
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        assert close_code(ws) == 1012


def set_expiry(sync_db_url: str, code: str, *, seconds: float) -> None:
    engine = sa.create_engine(sync_db_url)
    with engine.begin() as conn:
        conn.execute(
            sa.update(Party)
            .where(Party.code == code)
            .values(expires_at=utcnow() + timedelta(seconds=seconds))
        )
    engine.dispose()
