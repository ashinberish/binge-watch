"""PartyHub contract, run against every implementation.

``memory`` and ``fakeredis`` always run. A real Redis is exercised too when
``APP_TEST_REDIS_URL`` is set (e.g. ``redis://localhost:6379/15``; the test flushes it).
"""

import asyncio
import os
import uuid
from collections.abc import AsyncIterator

import fakeredis
import pytest
from redis.asyncio import Redis

from app.core.config import Settings
from app.modules.parties.hub import (
    InMemoryPartyHub,
    PartyHub,
    RedisPartyHub,
    Subscription,
    create_party_hub,
    next_state,
    parse_redis_state,
)
from app.modules.parties.schemas import PartyUser, PlaybackState

ALICE = PartyUser(id=uuid.UUID(int=1), display_name="Alice")
BOB = PartyUser(id=uuid.UUID(int=2), display_name="Bob")
REAL_REDIS_URL = os.environ.get("APP_TEST_REDIS_URL")


@pytest.fixture(params=["memory", "fakeredis", "redis"])
async def hub(request: pytest.FixtureRequest) -> AsyncIterator[PartyHub]:
    party_hub: PartyHub
    if request.param == "memory":
        party_hub = InMemoryPartyHub(ttl_seconds=60)
    elif request.param == "fakeredis":
        party_hub = RedisPartyHub(fakeredis.FakeAsyncRedis(decode_responses=True), ttl_seconds=60)
    else:
        if not REAL_REDIS_URL:
            pytest.skip("APP_TEST_REDIS_URL not set")
        client: Redis = Redis.from_url(REAL_REDIS_URL, decode_responses=True)
        await client.flushdb()
        party_hub = RedisPartyHub(client, ttl_seconds=60)
    yield party_hub
    await party_hub.close()


async def get(sub: Subscription) -> object:
    return await asyncio.wait_for(sub.get(), timeout=2)


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
        assert await hub.connect("room", ALICE.id) == 1
        assert await hub.connect("room", BOB.id) == 2
        assert await hub.connect("room", BOB.id) == 2  # second tab
        assert await hub.member_count("room") == 2
        assert await hub.disconnect("room", BOB.id) == 2
        assert await hub.disconnect("room", BOB.id) == 1
        assert await hub.disconnect("room", ALICE.id) == 0
        counts = [await get(sub) for _ in range(6)]
    assert [c["count"] for c in counts] == [1, 2, 2, 2, 1, 0]  # type: ignore[index]


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
    await hub.connect("room", ALICE.id)
    keys = sorted(await client.keys("*"))
    assert keys == ["nightreel:party:{room}:members", "nightreel:party:{room}:state"]
    for key in keys:
        assert 0 < await client.ttl(key) <= 3600
    assert hub.channel("room") == "nightreel:party:{room}:events"
    await hub.close()


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
