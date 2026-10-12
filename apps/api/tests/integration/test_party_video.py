"""Switching a watch party to another video over the WebSocket (``{"type": "video"}``).

Runs against the in-memory hub, a ``fakeredis``-backed ``RedisPartyHub`` and, when
``APP_TEST_REDIS_URL`` is set, a real Redis (the test flushes that DB).
"""

import os
import time
import uuid
from collections.abc import Iterator
from typing import Any

import fakeredis
import pytest
import redis
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from starlette.testclient import WebSocketTestSession

from app.core.config import Settings
from app.db.models import Base
from app.main import create_app
from app.modules.catalog.models import Episode, Season, Show
from app.modules.parties import realtime
from app.modules.parties.hub import RedisPartyHub
from tests.integration.test_party_ws import (
    WATCH_URL,
    authed,
    next_of,
    signup,
    until,
    ws_connect,
)

REAL_REDIS_URL = os.environ.get("APP_TEST_REDIS_URL")
NEW_URL = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
OTHER_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
ORIGINAL_VIDEO = {"watch_url": WATCH_URL, "provider": "youtube", "episode_id": None}


@pytest.fixture(params=["memory", "fakeredis", "redis"])
def tc(request: pytest.FixtureRequest, settings: Settings) -> Iterator[TestClient]:
    backend = request.param
    if backend == "redis":
        if not REAL_REDIS_URL:
            pytest.skip("APP_TEST_REDIS_URL not set")
        flusher = redis.Redis.from_url(REAL_REDIS_URL)
        flusher.flushdb()
        flusher.close()
        settings = settings.model_copy(update={"party_hub": "redis", "redis_url": REAL_REDIS_URL})
    engine = sa.create_engine(settings.database_url.replace("sqlite+aiosqlite", "sqlite"))
    Base.metadata.create_all(engine)
    engine.dispose()
    app = create_app(settings)
    swapped: RedisPartyHub | None = None
    if backend == "fakeredis":
        swapped = RedisPartyHub(
            fakeredis.FakeAsyncRedis(decode_responses=True),
            ttl_seconds=settings.party_ttl_seconds,
        )
        app.state.party_hub = swapped
    with TestClient(app) as client:
        yield client
        if swapped is not None:
            client.portal.call(swapped.close)  # type: ignore[union-attr]


@pytest.fixture
def sync_db_url(settings: Settings) -> str:
    return settings.database_url.replace("sqlite+aiosqlite", "sqlite")


@pytest.fixture
def alice(tc: TestClient) -> dict[str, Any]:
    return signup(tc, "alice@example.com", "Alice")


@pytest.fixture
def bob(tc: TestClient) -> dict[str, Any]:
    return signup(tc, "bob@example.com", "Bob")


@pytest.fixture
def code(tc: TestClient, alice: dict[str, Any], bob: dict[str, Any]) -> str:
    """A party hosted by Alice that Bob (not the host) has joined."""
    resp = tc.post(
        "/api/v1/parties",
        json={"provider": "youtube", "watch_url": WATCH_URL},
        headers=alice["headers"],
    )
    assert resp.status_code == 201, resp.text
    party_code: str = resp.json()["code"]
    assert tc.post(f"/api/v1/parties/{party_code}/join", headers=bob["headers"]).status_code == 200
    return party_code


@pytest.fixture
def episode_id(tc: TestClient, sync_db_url: str) -> str:
    engine = sa.create_engine(sync_db_url)
    episode = Episode(number=1, title="Pilot", duration_seconds=1500)
    with Session(engine) as db:
        db.add(Show(title="Switcheroo", seasons=[Season(number=1, episodes=[episode])]))
        db.commit()
        ep_id = str(episode.id)
    engine.dispose()
    return ep_id


@pytest.fixture
def no_video_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(realtime, "VIDEO_RATE_LIMIT", 1000)


def video_frame(watch_url: str, provider: str = "youtube", episode: str | None = None) -> Any:
    return {"type": "video", "watch_url": watch_url, "provider": provider, "episode_id": episode}


def playback_frames(ws: WebSocketTestSession, seq: int) -> list[dict[str, Any]]:
    """``video`` and ``state`` frames up to the state with ``seq``."""
    frames = []
    for _ in range(100):
        msg: dict[str, Any] = ws.receive_json()
        if msg["type"] in {"video", "state"}:
            frames.append(msg)
            if msg["type"] == "state" and msg["state"]["seq"] == seq:
                return frames
    raise AssertionError(f"no state with seq {seq}")


def marker(ws: WebSocketTestSession, text: str = "marker") -> list[dict[str, Any]]:
    """Every frame up to our own chat echo. Broadcasts are ordered in the hub, so anything
    the earlier frames caused has been broadcast (and errors sent) by then."""
    ws.send_json({"type": "chat", "text": text})
    return until(ws, "chat")


def party(tc: TestClient, code: str, who: dict[str, Any]) -> dict[str, Any]:
    resp = tc.get(f"/api/v1/parties/{code}", headers=who["headers"])
    assert resp.status_code == 200
    body: dict[str, Any] = resp.json()
    return body


def test_welcome_includes_original_video(tc: TestClient, code: str, alice: dict[str, Any]) -> None:
    with ws_connect(tc, code) as ws:
        welcome = authed(ws, alice)
    assert welcome["video"] == ORIGINAL_VIDEO


def test_member_switches_video_for_everyone(
    tc: TestClient,
    code: str,
    alice: dict[str, Any],
    bob: dict[str, Any],
    episode_id: str,
) -> None:
    with ws_connect(tc, code) as wa, ws_connect(tc, code) as wb:
        authed(wa, alice)
        authed(wb, bob)
        wa.send_json({"type": "control", "action": "pause", "position": 30, "rate": 1.5})
        for ws in (wa, wb):
            assert next_of(ws, "state")["state"]["seq"] == 1

        before = time.time()
        wb.send_json(video_frame(NEW_URL, "youtube", episode_id))  # Bob is not the host
        received = [playback_frames(ws, 2) for ws in (wa, wb)]  # sender included
        assert received[0] == received[1]
        video, state = received[0]  # video first, then state
        assert video == {
            "type": "video",
            "video": {"watch_url": NEW_URL, "provider": "youtube", "episode_id": episode_id},
            "by": {"id": bob["user"]["id"], "display_name": "Bob"},
            "seq": 2,
        }
        assert state["type"] == "state"
        st = state["state"]
        assert (st["paused"], st["position"], st["rate"], st["seq"]) == (False, 0.0, 1.0, 2)
        assert st["by"] == {"id": bob["user"]["id"], "display_name": "Bob"}
        assert before - 1 <= st["updated_at"] <= time.time() + 1

        marker(wb)  # the change is committed once Bob's next frame is handled
        body = party(tc, code, alice)
        assert (body["watch_url"], body["provider"], body["episode_id"]) == (
            NEW_URL,
            "youtube",
            episode_id,
        )
        assert body["host"]["display_name"] == "Alice"  # the party (and host) is kept

        # Controls carry on from the new video's state.
        wa.send_json({"type": "control", "action": "seek", "position": 12})
        assert next_of(wb, "state")["state"]["seq"] == 3

    # Reconnecting clients and late joiners get the current video and state.
    with ws_connect(tc, code) as ws:
        welcome = authed(ws, alice)
    assert welcome["video"] == video["video"]
    assert (welcome["state"]["seq"], welcome["state"]["position"]) == (3, 12.0)


def test_same_video_is_a_no_op(
    tc: TestClient, code: str, alice: dict[str, Any], bob: dict[str, Any], no_video_limit: None
) -> None:
    with ws_connect(tc, code) as wa, ws_connect(tc, code) as wb:
        authed(wa, alice)
        authed(wb, bob)
        wa.send_json(video_frame(WATCH_URL))
        wa.send_json(video_frame(f"  {WATCH_URL} ", "other-provider"))  # trimmed: same URL
        frames = marker(wa) + until(wb, "chat")
        assert not [f for f in frames if f["type"] in {"video", "state", "error"}]

        wb.send_json(video_frame(NEW_URL))
        playback_frames(wa, 1)
        wa.send_json(video_frame(NEW_URL))  # now current: no-op again
        frames = marker(wa, "again")
        assert not [f for f in frames if f["type"] in {"video", "state", "error"}]
    with ws_connect(tc, code) as ws:
        welcome = authed(ws, bob)
    assert welcome["state"]["seq"] == 1
    assert welcome["video"]["watch_url"] == NEW_URL


@pytest.mark.parametrize(
    ("frame", "detail"),
    [
        (video_frame("http://www.youtube.com/watch?v=x"), "video.watch_url: Value error, must be"),
        (
            video_frame("https://evil.example/watch?v=x"),
            "video.watch_url: Value error, this site is not supported for parties",
        ),
        (video_frame("https://user:pw@www.youtube.com/watch"), "must not contain credentials"),
        (video_frame("notaurl"), "video.watch_url"),
        (video_frame(NEW_URL, "YouTube!"), "video.provider"),
        (video_frame(NEW_URL, episode=str(uuid.uuid4())), "Value error, unknown episode"),
        (video_frame(NEW_URL, episode="not-a-uuid"), "video.episode_id"),
        ({"type": "video", "provider": "youtube"}, "video.watch_url"),
        (video_frame("https://www.youtube.com/" + "x" * 2100), "video.watch_url"),
    ],
)
def test_invalid_video_gets_error(
    tc: TestClient, code: str, alice: dict[str, Any], frame: dict[str, Any], detail: str
) -> None:
    with ws_connect(tc, code) as ws:
        authed(ws, alice)
        ws.send_json(frame)
        frames = marker(ws)
    errors = [f["detail"] for f in frames if f["type"] == "error"]
    assert len(errors) == 1
    assert detail in errors[0]
    assert not [f for f in frames if f["type"] in {"video", "state"}]
    assert party(tc, code, alice)["watch_url"] == WATCH_URL


def test_video_changes_are_rate_limited_per_user(
    tc: TestClient,
    code: str,
    alice: dict[str, Any],
    bob: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(realtime, "VIDEO_RATE_WINDOW_SECONDS", 0.5)
    with ws_connect(tc, code) as wa, ws_connect(tc, code) as wb1, ws_connect(tc, code) as wb2:
        authed(wa, alice)
        authed(wb1, bob)
        authed(wb2, bob)
        wb1.send_json(video_frame(NEW_URL))
        playback_frames(wa, 1)
        playback_frames(wb1, 1)
        wb2.send_json(video_frame(OTHER_URL))  # Bob's other tab: same per-user limit
        frames = marker(wb2)
        assert [f["detail"] for f in frames if f["type"] == "error"] == [
            "Wait a moment before changing the video."
        ]
        assert [f["video"]["watch_url"] for f in frames if f["type"] == "video"] == [NEW_URL]
        # Alice has her own allowance.
        wa.send_json(video_frame(OTHER_URL))
        assert next_of(wb1, "video")["by"]["display_name"] == "Alice"
        playback_frames(wa, 2)
        time.sleep(0.6)
        wb2.send_json(video_frame(NEW_URL))
        video = next_of(wa, "video")
    assert (video["video"]["watch_url"], video["by"]["display_name"]) == (NEW_URL, "Bob")
    assert party(tc, code, alice)["watch_url"] == NEW_URL


def test_concurrent_switches_agree_everywhere(
    tc: TestClient, code: str, alice: dict[str, Any], bob: dict[str, Any]
) -> None:
    with ws_connect(tc, code) as wa, ws_connect(tc, code) as wb:
        authed(wa, alice)
        authed(wb, bob)
        wa.send_json(video_frame(NEW_URL))
        wb.send_json(video_frame(OTHER_URL))
        seen = [playback_frames(ws, 2) for ws in (wa, wb)]
        marker(wa)
        marker(wb)
    assert seen[0] == seen[1]
    assert [(f["type"], f.get("seq", f.get("state", {}).get("seq"))) for f in seen[0]] == [
        ("video", 1),
        ("state", 1),
        ("video", 2),
        ("state", 2),
    ]
    last = seen[0][2]["video"]["watch_url"]
    assert party(tc, code, alice)["watch_url"] == last
    with ws_connect(tc, code) as ws:
        assert authed(ws, alice)["video"]["watch_url"] == last


def test_video_survives_controls_and_reconnects(
    tc: TestClient, code: str, alice: dict[str, Any], bob: dict[str, Any]
) -> None:
    with ws_connect(tc, code) as wa:
        authed(wa, alice)
        wa.send_json(video_frame(NEW_URL))
        playback_frames(wa, 1)
        for i in range(3):
            wa.send_json({"type": "control", "action": "seek", "position": i})
        playback_frames(wa, 4)
    with ws_connect(tc, code) as wb:
        welcome = authed(wb, bob)
    assert welcome["video"] == {"watch_url": NEW_URL, "provider": "youtube", "episode_id": None}
    assert welcome["state"]["seq"] == 4
