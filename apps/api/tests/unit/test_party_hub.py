"""PartyHub contract, run against every implementation.

``memory`` and ``fakeredis`` always run. A real Redis is exercised too when
``APP_TEST_REDIS_URL`` is set (e.g. ``redis://localhost:6379/15``; the test flushes it).
"""

import asyncio
import os
import time
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any

import fakeredis
import pytest
from redis.asyncio import Redis

from app.core.config import Settings
from app.modules.parties.hub import (
    CHAT_HISTORY_SIZE,
    InMemoryPartyHub,
    PartyHub,
    PresenceNotifier,
    RedisPartyHub,
    Subscription,
    create_party_hub,
    next_state,
    parse_redis_state,
)
from app.modules.parties.schemas import (
    ChatMessage,
    PartyUser,
    PlaybackState,
    PresenceMember,
    Reaction,
    sort_members,
)

ALICE = PartyUser(id=uuid.UUID(int=1), display_name="Alice")
BOB = PartyUser(id=uuid.UUID(int=2), display_name="Bob")
CAROL = PartyUser(id=uuid.UUID(int=3), display_name="Carol")
PRESENCE_DELAY = 0.02
REAL_REDIS_URL = os.environ.get("APP_TEST_REDIS_URL")


@pytest.fixture(params=["memory", "fakeredis", "redis"])
async def hub(request: pytest.FixtureRequest) -> AsyncIterator[PartyHub]:
    party_hub: PartyHub
    if request.param == "memory":
        party_hub = InMemoryPartyHub(ttl_seconds=60, presence_delay=PRESENCE_DELAY)
    elif request.param == "fakeredis":
        party_hub = RedisPartyHub(
            fakeredis.FakeAsyncRedis(decode_responses=True),
            ttl_seconds=60,
            presence_delay=PRESENCE_DELAY,
        )
    else:
        if not REAL_REDIS_URL:
            pytest.skip("APP_TEST_REDIS_URL not set")
        client: Redis = Redis.from_url(REAL_REDIS_URL, decode_responses=True)
        await client.flushdb()
        party_hub = RedisPartyHub(client, ttl_seconds=60, presence_delay=PRESENCE_DELAY)
    yield party_hub
    await party_hub.close()


async def get(sub: Subscription) -> object:
    return await asyncio.wait_for(sub.get(), timeout=2)


async def next_of(sub: Subscription, kind: str) -> dict[str, Any]:
    """Next event of ``kind``, skipping others (e.g. presence frames between counts)."""
    while True:
        event = await get(sub)
        assert isinstance(event, dict)
        if event["type"] == kind:
            return event


async def presence_until(
    sub: Subscription, predicate: Callable[[list[dict[str, Any]]], bool]
) -> list[dict[str, Any]]:
    """Read presence frames until one satisfies ``predicate`` (frames are coalesced)."""
    while True:
        members: list[dict[str, Any]] = (await next_of(sub, "presence"))["members"]
        if predicate(members):
            return members


def names(members: list[dict[str, Any]] | list[PresenceMember]) -> list[str]:
    return [m["display_name"] if isinstance(m, dict) else m.display_name for m in members]


async def connect(hub: PartyHub, user: PartyUser, *, host: bool = False, now: float = 1.0) -> int:
    return await hub.connect("room", user, is_host=host, now=now)


def chat(n: int, *, user: PartyUser = ALICE, sent_at: float | None = None) -> ChatMessage:
    return ChatMessage(
        id=f"m{n}",
        user=user,
        text=f"hello {n} ✨",
        sent_at=1_791_763_200.123456 + n if sent_at is None else sent_at,
    )


async def connect_on_dead_process(hub: PartyHub, *users: PartyUser) -> None:
    """Connect ``users`` through another API process, which then dies without cleaning up
    (its heartbeat key expires)."""
    if isinstance(hub, InMemoryPartyHub):
        own = hub.proc_id
        hub.proc_id = "ghost"
        hub._procs["ghost"] = hub._procs[own] = time.monotonic() + 60
        for user in users:
            await connect(hub, user, now=5.0)
        hub.proc_id = own
        del hub._procs["ghost"], hub._procs[own]
    else:
        assert isinstance(hub, RedisPartyHub)
        other = RedisPartyHub(hub._redis, ttl_seconds=60)
        for user in users:
            await connect(other, user, now=5.0)
        assert other._heartbeat is not None
        other._heartbeat.cancel()
        await hub._redis.delete(other.proc_key(other.proc_id))


async def control(hub: PartyHub, action: str, position: float, **kw: object) -> PlaybackState:
    return await hub.apply_control(
        "room",
        action=action,  # type: ignore[arg-type]
        position=position,
        rate=kw.get("rate"),  # type: ignore[arg-type]
        by=kw.get("by", ALICE),  # type: ignore[arg-type]
        now=float(kw.get("now", 1_791_763_200.123456)),  # type: ignore[arg-type]
    )


async def test_initial_state(hub: PartyHub) -> None:
    assert await hub.get_state("room") == PlaybackState()
    assert await hub.member_count("room") == 0


async def test_apply_control_orders_and_broadcasts(hub: PartyHub) -> None:
    async with hub.subscribe("room") as sub, hub.subscribe("other") as other:
        s1 = await control(hub, "play", 12.25, now=1_791_763_200.123456)
        s2 = await control(hub, "seek", 1234.5678901234, rate=1.5, by=BOB)
        s3 = await control(hub, "pause", 1300)
        s4 = await control(hub, "seek", 5)

        assert [s.seq for s in (s1, s2, s3, s4)] == [1, 2, 3, 4]
        assert (s1.paused, s1.position, s1.rate, s1.by) == (False, 12.25, 1.0, ALICE)
        assert s1.updated_at == 1_791_763_200.123456  # no float truncation
        assert (s2.paused, s2.position, s2.rate, s2.by) == (False, 1234.5678901234, 1.5, BOB)
        assert (s3.paused, s3.rate) == (True, 1.5)  # rate sticks
        assert (s4.paused, s4.position) == (True, 5.0)  # seek keeps paused

        for expected in (s1, s2, s3, s4):
            assert await get(sub) == {"type": "state", "state": expected.model_dump(mode="json")}
        assert await hub.get_state("room") == s4

        # Other rooms see nothing.
        await hub.publish("other", {"type": "members", "count": 7})
        assert await get(other) == {"type": "members", "count": 7}


async def test_concurrent_controls_get_unique_seqs(hub: PartyHub) -> None:
    states = await asyncio.gather(*(control(hub, "seek", float(i)) for i in range(25)))
    assert sorted(s.seq for s in states) == list(range(1, 26))
    final = await hub.get_state("room")
    assert final.seq == 25
    assert final == next(s for s in states if s.seq == 25)


async def test_member_counts_are_distinct_users(hub: PartyHub) -> None:
    async with hub.subscribe("room") as sub:
        assert await connect(hub, ALICE) == 1
        assert await connect(hub, BOB) == 2
        assert await connect(hub, BOB) == 2  # second tab
        assert await hub.member_count("room") == 2
        assert await hub.disconnect("room", BOB.id) == 2
        assert await hub.disconnect("room", BOB.id) == 1
        assert await hub.disconnect("room", ALICE.id) == 0
        counts = [await next_of(sub, "members") for _ in range(6)]
    assert [c["count"] for c in counts] == [1, 2, 2, 2, 1, 0]
    # A disconnect without a matching connect is harmless.
    assert await hub.disconnect("room", ALICE.id) == 0
    assert await hub.presence("room") == []


async def test_presence_lists_users_once_host_first(hub: PartyHub) -> None:
    async with hub.subscribe("room") as sub:
        await connect(hub, BOB, now=10.5)
        await connect(hub, CAROL, now=11.0)
        await connect(hub, ALICE, host=True, now=20.25)
        await connect(hub, BOB, now=30.0)  # second tab: listed once, joined_at kept

        expected = [
            PresenceMember(
                id=ALICE.id, display_name="Alice", is_host=True, status="watching", joined_at=20.25
            ),
            PresenceMember(
                id=BOB.id, display_name="Bob", is_host=False, status="watching", joined_at=10.5
            ),
            PresenceMember(
                id=CAROL.id, display_name="Carol", is_host=False, status="watching", joined_at=11
            ),
        ]
        assert await hub.presence("room") == expected
        members = await presence_until(sub, lambda m: len(m) == 3)
        assert members == [m.model_dump(mode="json") for m in expected]

        # Per user: the most recent status wins, whichever tab sent it.
        assert await hub.set_status("room", BOB.id, "ad") is True
        assert await hub.set_status("room", BOB.id, "buffering") is True
        members = await presence_until(sub, lambda m: m[1]["status"] == "buffering")
        assert [m["status"] for m in members] == ["watching", "buffering", "watching"]
        assert await hub.set_status("room", BOB.id, "buffering") is True  # unchanged

        # Bob's first tab closes: still listed. His last tab closes: gone.
        await hub.disconnect("room", BOB.id)
        assert names(await hub.presence("room")) == ["Alice", "Bob", "Carol"]
        await hub.disconnect("room", BOB.id)
        assert names(await hub.presence("room")) == ["Alice", "Carol"]
        members = await presence_until(sub, lambda m: len(m) == 2)
        assert names(members) == ["Alice", "Carol"]
        assert await hub.set_status("room", BOB.id, "away") is False  # not connected

        # Coming back resets the status but keeps the first-connect time.
        await connect(hub, BOB, now=99.0)
        bob = (await hub.presence("room"))[1]
        assert (bob.display_name, bob.status, bob.joined_at) == ("Bob", "watching", 10.5)


async def test_presence_frames_are_coalesced(hub: PartyHub) -> None:
    async with hub.subscribe("room") as sub:
        for user in (ALICE, BOB, CAROL):
            await connect(hub, user)
        await hub.set_status("room", CAROL.id, "away")
        events = [await get(sub) for _ in range(4)]  # 3 member counts + 1 presence
    kinds = [e["type"] for e in events]  # type: ignore[index]
    assert kinds.count("members") == 3
    assert kinds.count("presence") == 1
    presence = next(e for e in events if e["type"] == "presence")  # type: ignore[index]
    assert [m["status"] for m in presence["members"]] == ["watching", "watching", "away"]  # type: ignore[index]


async def test_dead_process_connections_are_dropped(hub: PartyHub) -> None:
    await connect(hub, ALICE, host=True)
    await connect(hub, CAROL)  # Carol also has a tab on a live process
    await connect_on_dead_process(hub, BOB, CAROL)
    async with hub.subscribe("room") as sub:
        # Reads already ignore the dead process...
        assert await hub.member_count("room") == 2
        assert names(await hub.presence("room")) == ["Alice", "Carol"]
        # ...and a sweep deletes its entries and tells everyone.
        assert await hub.sweep("room") == 2
        assert (await next_of(sub, "members"))["count"] == 2
        members = await presence_until(sub, lambda m: len(m) == 2)
        assert names(members) == ["Alice", "Carol"]
        assert await hub.sweep("room") == 2  # idempotent
        # Disconnecting Carol's live tab drops her too.
        assert await hub.disconnect("room", CAROL.id) == 1


async def test_mutations_prune_dead_processes(hub: PartyHub) -> None:
    await connect_on_dead_process(hub, BOB)
    assert await connect(hub, ALICE) == 1
    assert names(await hub.presence("room")) == ["Alice"]


async def test_chat_history_is_capped_and_ordered(hub: PartyHub) -> None:
    assert await hub.chat_history("room") == []
    async with hub.subscribe("room") as sub:
        assert await hub.post_chat("room", chat(0), limit=100, window=5) is True
        assert await get(sub) == {"type": "chat", "message": chat(0).model_dump(mode="json")}
    for n in range(1, 55):
        assert await hub.post_chat("room", chat(n), limit=100, window=5) is True
    history = await hub.chat_history("room")
    assert len(history) == CHAT_HISTORY_SIZE == 50
    assert history == [chat(n) for n in range(5, 55)]  # oldest -> newest, floats intact


async def test_chat_rate_limit_per_user(hub: PartyHub) -> None:
    t = 1_791_763_200.5
    assert await hub.post_chat("room", chat(1, sent_at=t), limit=2, window=5) is True
    assert await hub.post_chat("room", chat(2, sent_at=t + 1), limit=2, window=5) is True
    assert await hub.post_chat("room", chat(3, sent_at=t + 2), limit=2, window=5) is False
    assert await hub.post_chat("room", chat(4, user=BOB, sent_at=t + 2), limit=2, window=5)
    # The first message leaves the 5 s window at t + 5.
    assert await hub.post_chat("room", chat(5, sent_at=t + 5.01), limit=2, window=5) is True
    assert [m.id for m in await hub.chat_history("room")] == ["m1", "m2", "m4", "m5"]


async def test_reactions_broadcast_rate_limited_not_stored(hub: PartyHub) -> None:
    t = 1_791_763_200.25
    reactions = [Reaction(id=f"r{i}", kind="fire", user=ALICE, at=t + i / 10) for i in range(4)]
    async with hub.subscribe("room") as sub:
        sent = [await hub.react("room", r, limit=3, window=1) for r in reactions]
        assert sent == [True, True, True, False]
        for r in reactions[:3]:
            assert await get(sub) == {
                "type": "reaction",
                "id": r.id,
                "kind": "fire",
                "user": {"id": str(ALICE.id), "display_name": "Alice"},
                "at": r.at,
            }
        later = Reaction(id="r9", kind="clap", user=ALICE, at=t + 1.5)
        assert await hub.react("room", later, limit=3, window=1) is True
        assert (await get(sub))["id"] == "r9"  # type: ignore[index]
    assert await hub.chat_history("room") == []


async def test_end_clears_presence_and_chat(hub: PartyHub) -> None:
    await connect(hub, ALICE, host=True)
    await hub.post_chat("room", chat(1), limit=5, window=5)
    await hub.end("room")
    assert await hub.chat_history("room") == []
    assert await hub.presence("room") == []
    assert await hub.member_count("room") == 0


async def test_end_broadcasts_and_resets(hub: PartyHub) -> None:
    await control(hub, "play", 3)
    async with hub.subscribe("room") as sub:
        await hub.end("room")
        assert await get(sub) == {"type": "ended"}
    assert await hub.get_state("room") == PlaybackState()


async def test_multiple_subscribers_and_unsubscribe(hub: PartyHub) -> None:
    async with hub.subscribe("room") as a:
        async with hub.subscribe("room") as b:
            await hub.publish("room", {"type": "members", "count": 1})
            assert await get(a) == await get(b) == {"type": "members", "count": 1}
        await hub.publish("room", {"type": "members", "count": 2})
        assert await get(a) == {"type": "members", "count": 2}
    # Re-subscribing after everyone left works.
    async with hub.subscribe("room") as c:
        await hub.publish("room", {"type": "ended"})
        assert await get(c) == {"type": "ended"}


async def test_close_ends_subscriptions(hub: PartyHub) -> None:
    async with hub.subscribe("room") as sub:
        await hub.close()
        assert await get(sub) is None


async def test_memory_state_expires() -> None:
    hub = InMemoryPartyHub(ttl_seconds=0)
    await control(hub, "play", 1)
    assert await hub.get_state("room") == PlaybackState()


async def test_redis_keys_carry_ttl_and_hash_tag() -> None:
    client = fakeredis.FakeAsyncRedis(decode_responses=True)
    hub = RedisPartyHub(client, ttl_seconds=3600)
    await control(hub, "play", 1)
    await connect(hub, ALICE)
    await hub.post_chat("room", chat(1), limit=5, window=5)
    await hub.react("room", Reaction(id="r", kind="wow", user=BOB, at=1.0), limit=3, window=1)
    proc_key = f"nightreel:party:proc:{hub.proc_id}"
    party_keys = sorted(k for k in await client.keys("*") if k != proc_key)
    assert party_keys == [
        "nightreel:party:{room}:chat",
        "nightreel:party:{room}:joined",
        "nightreel:party:{room}:members",
        "nightreel:party:{room}:presence",
        f"nightreel:party:{{room}}:rate:chat:{ALICE.id}",
        f"nightreel:party:{{room}}:rate:react:{BOB.id}",
        "nightreel:party:{room}:state",
        "nightreel:party:{room}:status",
    ]
    for key in party_keys:
        assert 0 < await client.ttl(key) <= 3600
    assert 0 < await client.ttl(proc_key) <= 45
    assert await client.hkeys("nightreel:party:{room}:members") == [f"{ALICE.id}|{hub.proc_id}"]
    assert hub.channel("room") == "nightreel:party:{room}:events"
    # A graceful shutdown removes the heartbeat key right away.
    await hub.close()
    assert not await client.exists(proc_key)


async def test_redis_heartbeat_refreshes_and_sweeps() -> None:
    client = fakeredis.FakeAsyncRedis(decode_responses=True)
    hub = RedisPartyHub(client, ttl_seconds=60, heartbeat_seconds=0.05)
    await connect(hub, ALICE)
    await connect_on_dead_process(hub, BOB)
    async with hub.subscribe("room") as sub:
        assert await hub.member_count("room") == 1
        await client.delete(hub.proc_key(hub.proc_id))
        # No mutation needed: the heartbeat loop re-creates our key and sweeps Bob out.
        assert (await next_of(sub, "members"))["count"] == 1
        assert await client.exists(hub.proc_key(hub.proc_id))
    await hub.close()


async def test_redis_counts_pre_presence_fields() -> None:
    """Connections written by an older API version (bare user id) still count."""
    client = fakeredis.FakeAsyncRedis(decode_responses=True)
    hub = RedisPartyHub(client, ttl_seconds=60)
    await client.hset("nightreel:party:{room}:members", str(BOB.id), "1")
    assert await hub.member_count("room") == 1
    assert await connect(hub, ALICE) == 2
    await hub.close()


async def test_presence_notifier_survives_load_errors() -> None:
    hub = InMemoryPartyHub(ttl_seconds=60, presence_delay=0)
    calls = 0

    async def flaky(code: str) -> list[PresenceMember]:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("redis down")
        return []

    notifier = PresenceNotifier(hub._fanout, flaky, 0)
    async with hub.subscribe("room") as sub:
        notifier.schedule("room")
        await asyncio.sleep(0.01)
        notifier.schedule("room")
        assert await get(sub) == {"type": "presence", "members": []}
    notifier.schedule("nobody-listening")
    await notifier.close()
    await hub.close()
    notifier.schedule("room")  # after close: ignored
    assert calls == 2


def test_sort_members_host_first_then_joined() -> None:
    a = PresenceMember(id=ALICE.id, display_name="A", is_host=False, joined_at=3)
    b = PresenceMember(id=BOB.id, display_name="B", is_host=True, joined_at=9)
    c = PresenceMember(id=CAROL.id, display_name="C", is_host=False, joined_at=1)
    assert sort_members([a, b, c]) == [b, c, a]


async def test_redis_reader_ignores_foreign_and_bad_messages() -> None:
    client = fakeredis.FakeAsyncRedis(decode_responses=True)
    hub = RedisPartyHub(client, ttl_seconds=60)
    async with hub.subscribe("room") as sub:
        await client.publish(hub.channel("room"), "not json")
        await client.publish(hub.channel("room"), "[1, 2]")
        hub._dispatch("some:other:channel", '{"type": "ended"}')
        await client.publish(hub.channel("room"), '{"type": "ended"}')
        assert await get(sub) == {"type": "ended"}
    await hub.close()


def test_parse_redis_state_defaults() -> None:
    assert parse_redis_state({}) == PlaybackState()
    assert parse_redis_state({"seq": "3", "paused": "false"}) == PlaybackState(seq=3, paused=False)


def test_subscription_drops_oldest_when_full() -> None:
    sub = Subscription(maxsize=2)
    for i in range(3):
        sub.deliver({"n": i})
    assert sub._queue.get_nowait() == {"n": 1}
    assert sub._queue.get_nowait() == {"n": 2}


def test_next_state_rules() -> None:
    start = PlaybackState(paused=False, position=50, rate=2.0, updated_at=1.0, seq=7)
    seek = next_state(start, action="seek", position=10, rate=None, by=ALICE, now=9.0)
    assert seek == PlaybackState(
        paused=False, position=10, rate=2.0, updated_at=9.0, seq=8, by=ALICE
    )
    pause = next_state(seek, action="pause", position=11, rate=0.5, by=BOB, now=10.0)
    assert (pause.paused, pause.rate, pause.seq, pause.by) == (True, 0.5, 9, BOB)
    play = next_state(pause, action="play", position=11, rate=None, by=BOB, now=11.0)
    assert (play.paused, play.rate) == (False, 0.5)


def test_create_party_hub_selects_backend() -> None:
    assert isinstance(create_party_hub(Settings(party_hub="memory")), InMemoryPartyHub)
    assert isinstance(create_party_hub(Settings(party_hub="redis")), RedisPartyHub)
