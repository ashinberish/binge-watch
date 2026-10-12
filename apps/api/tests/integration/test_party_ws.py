"""Watch-party WebSocket protocol, driven through Starlette's TestClient.

These tests are synchronous: the TestClient runs the app (lifespan included) on its own
event loop, so the schema is created with a sync engine and every HTTP call goes through
the same TestClient.
"""

import time
from collections.abc import Callable, Iterator
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


def presence_until(
    ws: WebSocketTestSession, predicate: Callable[[list[dict[str, Any]]], bool]
) -> list[dict[str, Any]]:
    """Members of the first presence frame satisfying ``predicate`` (frames are coalesced)."""
    for _ in range(20):
        members: list[dict[str, Any]] = next_of(ws, "presence")["members"]
        if predicate(members):
            return members
    raise AssertionError("presence never matched")


def statuses(members: list[dict[str, Any]]) -> list[tuple[str, str]]:
    return [(m["display_name"], m["status"]) for m in members]


def sync(ws: WebSocketTestSession) -> list[dict[str, Any]]:
    """Ping and return every frame received before the pong (all earlier input handled)."""
    ws.send_json({"type": "ping"})
    frames = []
    for _ in range(100):
        msg: dict[str, Any] = ws.receive_json()
        if msg["type"] == "pong":
            return frames
        frames.append(msg)
    raise AssertionError("no pong")


def until(ws: WebSocketTestSession, kind: str, limit: int = 100) -> list[dict[str, Any]]:
    """Every frame up to and including the next one of ``kind``. Broadcasts reach sockets
    in hub order, so waiting on a broadcast (unlike on a pong) also works with Redis."""
    frames = []
    for _ in range(limit):
        msg: dict[str, Any] = ws.receive_json()
        frames.append(msg)
        if msg["type"] == kind:
            return frames
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
    before = time.time()
    with ws_connect(tc, code, origin="http://localhost:5173") as ws:
        welcome = authed(ws, alice)
    joined_at = welcome["members_list"][0]["joined_at"]
    assert before - 1 <= joined_at <= time.time() + 1
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
        "members_list": [
            {
                "id": alice["user"]["id"],
                "display_name": "Alice",
                "is_host": True,
                "status": "watching",
                "joined_at": joined_at,
            }
        ],
        "chat": [],
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


# --- presence ----------------------------------------------------------------------------


def test_presence_follows_connects_status_and_disconnects(
    tc: TestClient, code: str, alice: dict[str, Any], bob: dict[str, Any]
) -> None:
    with ws_connect(tc, code) as wa:
        welcome = authed(wa, alice)
        assert statuses(welcome["members_list"]) == [("Alice", "watching")]
        with ws_connect(tc, code) as wb:
            members = authed(wb, bob)["members_list"]
            assert [(m["display_name"], m["is_host"]) for m in members] == [
                ("Alice", True),
                ("Bob", False),
            ]
            assert members[0]["joined_at"] <= members[1]["joined_at"]
            assert members[1] == {
                "id": bob["user"]["id"],
                "display_name": "Bob",
                "is_host": False,
                "status": "watching",
                "joined_at": members[1]["joined_at"],
            }
            members = presence_until(wa, lambda m: len(m) == 2)
            assert statuses(members) == [("Alice", "watching"), ("Bob", "watching")]

            wb.send_json({"type": "status", "status": "ad"})
            for ws in (wa, wb):
                members = presence_until(ws, lambda m: m[1]["status"] == "ad")
                assert statuses(members) == [("Alice", "watching"), ("Bob", "ad")]

            wa.send_json({"type": "status", "status": "buffering"})
            members = presence_until(wb, lambda m: m[0]["status"] == "buffering")
            assert statuses(members) == [("Alice", "buffering"), ("Bob", "ad")]
        # Bob's only socket closed: he leaves the list.
        members = presence_until(wa, lambda m: len(m) == 1)
        assert statuses(members) == [("Alice", "buffering")]


@pytest.mark.parametrize(
    "frame",
    [
        {"type": "status", "status": "sleeping"},
        {"type": "status"},
        {"type": "status", "status": 3},
    ],
)
def test_invalid_status_gets_error(
    tc: TestClient, code: str, alice: dict[str, Any], frame: dict[str, Any]
) -> None:
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        ws.send_json(frame)
        assert next_of(ws, "error")["detail"].startswith("status.status")


def test_user_with_two_sockets_listed_once(
    tc: TestClient, code: str, alice: dict[str, Any], bob: dict[str, Any]
) -> None:
    with ws_connect(tc, code) as wa:
        authed(wa, alice)
        with ws_connect(tc, code) as wb1, ws_connect(tc, code) as wb2:
            authed(wb1, bob)
            members = authed(wb2, bob)["members_list"]
            assert statuses(members) == [("Alice", "watching"), ("Bob", "watching")]
            # Most recent status wins, from whichever tab.
            wb1.send_json({"type": "status", "status": "away"})
            presence_until(wa, lambda m: m[-1]["status"] == "away")
            wb2.send_json({"type": "status", "status": "watching"})
            members = presence_until(wa, lambda m: m[-1]["status"] == "watching")
            assert len(members) == 2
            # Closing one of Bob's tabs keeps him listed.
            wb1.close()
            sync(wb2)
            assert statuses(authed_list(tc, code, alice)) == [
                ("Alice", "watching"),
                ("Bob", "watching"),
            ]
        members = presence_until(wa, lambda m: len(m) == 1)
        assert statuses(members) == [("Alice", "watching")]


def authed_list(tc: TestClient, code: str, who: dict[str, Any]) -> list[dict[str, Any]]:
    """The member list a fresh socket of ``who`` is welcomed with."""
    with ws_connect(tc, code) as ws:
        members: list[dict[str, Any]] = authed(ws, who)["members_list"]
    return members


def test_host_listed_first(
    tc: TestClient, code: str, alice: dict[str, Any], bob: dict[str, Any]
) -> None:
    with ws_connect(tc, code) as wb:
        authed(wb, bob)  # Bob connects first...
        members = authed_list(tc, code, alice)
    # ...but Alice hosts.
    assert [(m["display_name"], m["is_host"]) for m in members] == [
        ("Alice", True),
        ("Bob", False),
    ]
    assert members[1]["joined_at"] <= members[0]["joined_at"]


# --- chat --------------------------------------------------------------------------------


def test_chat_broadcasts_to_everyone(
    tc: TestClient, code: str, alice: dict[str, Any], bob: dict[str, Any]
) -> None:
    with ws_connect(tc, code) as wa, ws_connect(tc, code) as wb:
        authed(wa, alice)
        authed(wb, bob)
        before = time.time()
        wb.send_json({"type": "chat", "text": "  hi   all\n\tready?\u0007 🍿 "})
        received = [next_of(ws, "chat") for ws in (wa, wb)]  # sender included
    assert received[0] == received[1]
    message = received[0]["message"]
    assert set(received[0]) == {"type", "message"}
    assert set(message) == {"id", "user", "text", "sent_at"}
    assert message["text"] == "hi all ready? 🍿"
    assert message["user"] == {"id": bob["user"]["id"], "display_name": "Bob"}
    assert len(message["id"]) == 32
    assert before - 1 <= message["sent_at"] <= time.time() + 1


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("a\r\nb", "a b"),
        ("\u0000x\u001by\u007f\u009bz", "xyz"),
        ("x\u0085y", "x y"),  # NEL is a line break: collapsed like \n
        ("l\u202eolleh", "lolleh"),
        ("👨\u200d👩\u200d👧", "👨\u200d👩\u200d👧"),  # zero-width joiners kept
        ("x" * 500, "x" * 500),
        ("  " + "y" * 500 + "   \n", "y" * 500),
    ],
)
def test_chat_text_is_cleaned(
    tc: TestClient, code: str, alice: dict[str, Any], text: str, expected: str
) -> None:
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        ws.send_json({"type": "chat", "text": text})
        assert next_of(ws, "chat")["message"]["text"] == expected


@pytest.mark.parametrize(
    ("frame", "detail"),
    [
        ({"type": "chat", "text": ""}, "chat.text: Value error, message is empty"),
        ({"type": "chat", "text": " \n\t\u0000 "}, "chat.text: Value error, message is empty"),
        ({"type": "chat", "text": "x" * 501}, "longer than 500 characters"),
        ({"type": "chat", "text": "a" + " " * 600 + "\u0001" * 600}, None),
        ({"type": "chat", "text": 5}, "chat.text: Input should be a valid string"),
        ({"type": "chat"}, "chat.text"),
    ],
)
def test_invalid_chat_gets_error(
    tc: TestClient, code: str, alice: dict[str, Any], frame: dict[str, Any], detail: str | None
) -> None:
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        ws.send_json(frame)
        if detail is None:  # long only before cleaning: accepted
            assert next_of(ws, "chat")["message"]["text"] == "a"
        else:
            assert detail in next_of(ws, "error")["detail"]
            assert not [f for f in sync(ws) if f["type"] == "chat"]


def test_chat_is_rate_limited_per_user(
    tc: TestClient, code: str, alice: dict[str, Any], bob: dict[str, Any]
) -> None:
    with ws_connect(tc, code) as wa1, ws_connect(tc, code) as wa2, ws_connect(tc, code) as wb:
        authed(wa1, alice)
        authed(wa2, alice)
        authed(wb, bob)
        for i in range(3):
            wa1.send_json({"type": "chat", "text": f"tab one {i}"})
        sync(wa1)
        for i in range(3):  # the limit is per user, not per socket
            wa2.send_json({"type": "chat", "text": f"tab two {i}"})
        frames = sync(wa2)
        errors = [f["detail"] for f in frames if f["type"] == "error"]
        assert errors == ["You're sending messages too quickly."]
        wb.send_json({"type": "chat", "text": "bob is fine"})
        texts = [next_of(wb, "chat")["message"]["text"] for _ in range(6)]
    assert texts == [*(f"tab one {i}" for i in range(3)), "tab two 0", "tab two 1", "bob is fine"]


def test_chat_history_for_late_joiner(
    tc: TestClient,
    code: str,
    alice: dict[str, Any],
    bob: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(realtime, "CHAT_RATE_LIMIT", 1000)
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        for i in range(55):
            ws.send_json({"type": "chat", "text": f"line {i}"})
        sync(ws)
    with ws_connect(tc, code) as ws:
        history = authed(ws, bob)["chat"]
    assert [m["text"] for m in history] == [f"line {i}" for i in range(5, 55)]
    assert history == sorted(history, key=lambda m: m["sent_at"])
    assert history[0]["user"]["display_name"] == "Alice"


# --- reactions ---------------------------------------------------------------------------


def test_reactions_broadcast(
    tc: TestClient, code: str, alice: dict[str, Any], bob: dict[str, Any]
) -> None:
    with ws_connect(tc, code) as wa, ws_connect(tc, code) as wb:
        authed(wa, alice)
        authed(wb, bob)
        before = time.time()
        wa.send_json({"type": "react", "kind": "laugh"})
        received = [next_of(ws, "reaction") for ws in (wa, wb)]
    assert received[0] == received[1]
    reaction = received[0]
    assert set(reaction) == {"type", "id", "kind", "user", "at"}
    assert reaction["kind"] == "laugh"
    assert reaction["user"] == {"id": alice["user"]["id"], "display_name": "Alice"}
    assert before - 1 <= reaction["at"] <= time.time() + 1
    # Not stored: a late joiner's welcome carries no reactions.
    with ws_connect(tc, code) as ws:
        assert "reaction" not in str(authed(ws, bob))


@pytest.mark.parametrize(
    "frame",
    [{"type": "react", "kind": "angry"}, {"type": "react"}, {"type": "react", "kind": ["heart"]}],
)
def test_invalid_reaction_gets_error(
    tc: TestClient, code: str, alice: dict[str, Any], frame: dict[str, Any]
) -> None:
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        ws.send_json(frame)
        assert next_of(ws, "error")["detail"].startswith("react.kind")


def test_reactions_are_rate_limited(
    tc: TestClient, code: str, alice: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(realtime, "REACT_RATE_WINDOW_SECONDS", 60.0)
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        for kind in ("heart", "laugh", "wow", "fire", "clap", "sad"):
            ws.send_json({"type": "react", "kind": kind})
        ws.send_json({"type": "chat", "text": "marker"})
        frames = until(ws, "chat")
    # Excess silently dropped: no error frames.
    assert [f["kind"] for f in frames if f["type"] == "reaction"] == ["heart", "laugh", "wow"]
    assert not [f for f in frames if f["type"] == "error"]


def test_chat_and_reaction_limits_are_separate_from_controls(
    tc: TestClient,
    code: str,
    alice: dict[str, Any],
    bob: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(realtime, "CONTROL_RATE_PER_SECOND", 0.001)
    monkeypatch.setattr(realtime, "CONTROL_BURST", 1.0)
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        ws.send_json({"type": "control", "action": "seek", "position": 1})
        ws.send_json({"type": "control", "action": "seek", "position": 2})  # dropped
        ws.send_json({"type": "chat", "text": "still allowed"})
        ws.send_json({"type": "react", "kind": "clap"})
        kinds = [f["type"] for f in until(ws, "reaction")]
    assert kinds.count("state") == 1
    assert "chat" in kinds


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
