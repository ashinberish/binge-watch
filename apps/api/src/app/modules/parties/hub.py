"""Realtime room state and fan-out for watch parties.

``PartyHub`` is the seam that lets the API scale out: the WebSocket handler only talks to
the hub, never to other connections directly.

- ``RedisPartyHub`` (default, ``APP_PARTY_HUB=redis``): playback state and connected-member
  counts live in Redis hashes (with the party TTL); every mutation runs as one Lua script
  that also ``PUBLISH``es the resulting event, so ``seq`` order and broadcast order agree
  across all API processes. Each process holds a single pub/sub connection and fans
  messages out to its local subscribers.
- ``InMemoryPartyHub`` (``APP_PARTY_HUB=memory``): the same contract within one process,
  for tests and single-process development.

Events published on a party channel are exactly the server→client WebSocket messages:
``{"type": "state", "state": {...}}``, ``{"type": "members", "count": n}`` and
``{"type": "ended"}``.
"""

import asyncio
import contextlib
import json
import time
import uuid
from collections import Counter
from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import Annotated, Any, Protocol

from fastapi import Depends
from redis.asyncio import Redis
from redis.asyncio.client import PubSub
from starlette.requests import HTTPConnection

from app.core.config import Settings
from app.core.logging import get_logger
from app.modules.parties.schemas import (
    DEFAULT_RATE,
    ControlAction,
    PartyUser,
    PlaybackState,
)

logger = get_logger(__name__)

Event = dict[str, Any]

SUBSCRIPTION_QUEUE_SIZE = 256


def members_event(count: int) -> Event:
    return {"type": "members", "count": count}


def state_event(state: PlaybackState) -> Event:
    return {"type": "state", "state": state.model_dump(mode="json")}


ENDED_EVENT: Event = {"type": "ended"}


def next_state(
    current: PlaybackState,
    *,
    action: ControlAction,
    position: float,
    rate: float | None,
    by: PartyUser,
    now: float,
) -> PlaybackState:
    """Apply one control to ``current``: last write wins, ``seq`` goes up by one."""
    if action == "play":
        paused = False
    elif action == "pause":
        paused = True
    else:  # seek keeps the play/pause state
        paused = current.paused
    return PlaybackState(
        paused=paused,
        position=position,
        rate=current.rate if rate is None else rate,
        updated_at=now,
        seq=current.seq + 1,
        by=by,
    )


class Subscription:
    """One listener's queue of party events. ``get()`` returns None once the hub closes.

    The queue is bounded; a listener that falls behind loses its *oldest* events, which is
    safe here because every state event carries the full state and a newer ``seq``.
    """

    def __init__(self, maxsize: int = SUBSCRIPTION_QUEUE_SIZE) -> None:
        self._queue: asyncio.Queue[Event | None] = asyncio.Queue(maxsize=maxsize)

    def deliver(self, event: Event | None) -> None:
        while True:
            try:
                self._queue.put_nowait(event)
                return
            except asyncio.QueueFull:
                with contextlib.suppress(asyncio.QueueEmpty):
                    self._queue.get_nowait()

    async def get(self) -> Event | None:
        return await self._queue.get()


class LocalFanout:
    """Per-process registry of subscriptions by party code."""

    def __init__(self) -> None:
        self._subs: dict[str, set[Subscription]] = {}
        self.closed = False

    def add(self, code: str, sub: Subscription) -> bool:
        """Register ``sub``; True if it is the first local subscriber of ``code``."""
        subs = self._subs.setdefault(code, set())
        subs.add(sub)
        return len(subs) == 1

    def remove(self, code: str, sub: Subscription) -> bool:
        """Unregister ``sub``; True if ``code`` has no local subscribers left."""
        subs = self._subs.get(code)
        if subs is None:
            return False
        subs.discard(sub)
        if subs:
            return False
        del self._subs[code]
        return True

    def deliver(self, code: str, event: Event) -> None:
        for sub in tuple(self._subs.get(code, ())):
            sub.deliver(event)

    def close(self) -> None:
        """Wake every listener with the end-of-stream marker (app shutdown)."""
        self.closed = True
        for subs in self._subs.values():
            for sub in subs:
                sub.deliver(None)


class PartyHub(Protocol):
    async def get_state(self, code: str) -> PlaybackState:
        """Current playback state (the initial paused-at-0 state if none yet)."""
        ...

    async def apply_control(
        self,
        code: str,
        *,
        action: ControlAction,
        position: float,
        rate: float | None,
        by: PartyUser,
        now: float,
    ) -> PlaybackState:
        """Atomically apply a control (seq + 1) and broadcast the new state."""
        ...

    async def publish(self, code: str, event: Event) -> None:
        """Broadcast an event to every connection of the party, on every process."""
        ...

    def subscribe(self, code: str) -> AbstractAsyncContextManager[Subscription]:
        """Receive the party's events for the duration of the context."""
        ...

    async def connect(self, code: str, user_id: uuid.UUID) -> int:
        """Count a connection of ``user_id``; broadcast and return connected-member count."""
        ...

    async def disconnect(self, code: str, user_id: uuid.UUID) -> int:
        """Undo one ``connect``; broadcast and return the connected-member count."""
        ...

    async def member_count(self, code: str) -> int:
        """Distinct users with at least one open connection."""
        ...

    async def end(self, code: str) -> None:
        """Broadcast ``ended`` and drop the party's realtime state."""
        ...

    async def close(self) -> None:
        """Release resources; open subscriptions receive end-of-stream."""
        ...


class InMemoryPartyHub:
    """Single-process hub. All mutations are synchronous between awaits, hence atomic."""

    def __init__(self, *, ttl_seconds: int) -> None:
        self._ttl = ttl_seconds
        self._states: dict[str, tuple[PlaybackState, float]] = {}
        self._members: dict[str, Counter[uuid.UUID]] = {}
        self._fanout = LocalFanout()

    async def get_state(self, code: str) -> PlaybackState:
        entry = self._states.get(code)
        if entry is None or entry[1] <= time.monotonic():
            self._states.pop(code, None)
            return PlaybackState()
        return entry[0]

    async def apply_control(
        self,
        code: str,
        *,
        action: ControlAction,
        position: float,
        rate: float | None,
        by: PartyUser,
        now: float,
    ) -> PlaybackState:
        current = await self.get_state(code)
        state = next_state(current, action=action, position=position, rate=rate, by=by, now=now)
        self._states[code] = (state, time.monotonic() + self._ttl)
        self._fanout.deliver(code, state_event(state))
        return state

    async def publish(self, code: str, event: Event) -> None:
        self._fanout.deliver(code, event)

    @asynccontextmanager
    async def subscribe(self, code: str) -> AsyncIterator[Subscription]:
        sub = Subscription()
        self._fanout.add(code, sub)
        if self._fanout.closed:
            sub.deliver(None)
        try:
            yield sub
        finally:
            self._fanout.remove(code, sub)

    async def connect(self, code: str, user_id: uuid.UUID) -> int:
        members = self._members.setdefault(code, Counter())
        members[user_id] += 1
        count = len(members)
        self._fanout.deliver(code, members_event(count))
        return count

    async def disconnect(self, code: str, user_id: uuid.UUID) -> int:
        members = self._members.get(code)
        if members is not None:
            members[user_id] -= 1
            if members[user_id] <= 0:
                del members[user_id]
            if not members:
                del self._members[code]
        count = await self.member_count(code)
        self._fanout.deliver(code, members_event(count))
        return count

    async def member_count(self, code: str) -> int:
        return len(self._members.get(code, ()))

    async def end(self, code: str) -> None:
        self._states.pop(code, None)
        self._fanout.deliver(code, ENDED_EVENT)

    async def close(self) -> None:
        self._fanout.close()


# Lua scripts run atomically in Redis; PUBLISH inside them keeps broadcast order == seq order.
# Floats arrive as Python-formatted JSON numbers and are concatenated verbatim (no cjson
# round-trip, which would truncate to 14 significant digits).
_APPLY_CONTROL_LUA = """
local paused = redis.call('HGET', KEYS[1], 'paused') or 'true'
local rate = redis.call('HGET', KEYS[1], 'rate') or ARGV[8]
if ARGV[1] == 'play' then paused = 'false' elseif ARGV[1] == 'pause' then paused = 'true' end
if ARGV[3] ~= '' then rate = ARGV[3] end
local seq = redis.call('HINCRBY', KEYS[1], 'seq', 1)
redis.call('HSET', KEYS[1], 'paused', paused, 'position', ARGV[2], 'rate', rate,
  'updated_at', ARGV[4], 'by', ARGV[5])
redis.call('EXPIRE', KEYS[1], ARGV[6])
local state = '{"paused":' .. paused .. ',"position":' .. ARGV[2] .. ',"rate":' .. rate
  .. ',"updated_at":' .. ARGV[4] .. ',"seq":' .. seq .. ',"by":' .. ARGV[5] .. '}'
redis.call('PUBLISH', ARGV[7], '{"type":"state","state":' .. state .. '}')
return state
"""

_CONNECT_LUA = """
redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
redis.call('EXPIRE', KEYS[1], ARGV[2])
local n = redis.call('HLEN', KEYS[1])
redis.call('PUBLISH', ARGV[3], '{"type":"members","count":' .. n .. '}')
return n
"""

_DISCONNECT_LUA = """
local c = redis.call('HINCRBY', KEYS[1], ARGV[1], -1)
if c <= 0 then redis.call('HDEL', KEYS[1], ARGV[1]) end
local n = redis.call('HLEN', KEYS[1])
redis.call('PUBLISH', ARGV[2], '{"type":"members","count":' .. n .. '}')
return n
"""


def _text(value: str | bytes) -> str:
    return value.decode() if isinstance(value, bytes) else value


def _json_float(value: float) -> str:
    return json.dumps(float(value))


def parse_redis_state(fields: dict[str, str]) -> PlaybackState:
    """Decode the ``state`` hash written by the apply-control script."""
    if not fields:
        return PlaybackState()
    by_raw = fields.get("by")
    by = json.loads(by_raw) if by_raw else None
    return PlaybackState(
        paused=fields.get("paused", "true") == "true",
        position=float(fields.get("position", 0.0)),
        rate=float(fields.get("rate", DEFAULT_RATE)),
        updated_at=float(fields.get("updated_at", 0.0)),
        seq=int(fields.get("seq", 0)),
        by=PartyUser.model_validate(by) if by is not None else None,
    )


class RedisPartyHub:
    """Multi-process hub backed by Redis (state hashes + one pub/sub channel per party)."""

    def __init__(
        self,
        redis: "Redis",
        *,
        ttl_seconds: int,
        key_prefix: str = "nightreel:party",
    ) -> None:
        self._redis = redis
        self._ttl = ttl_seconds
        self._prefix = key_prefix
        self._fanout = LocalFanout()
        self._pubsub: PubSub | None = None
        self._reader: asyncio.Task[None] | None = None
        self._lock: asyncio.Lock | None = None
        self._wakeup: asyncio.Event | None = None
        self._apply = redis.register_script(_APPLY_CONTROL_LUA)
        self._connect = redis.register_script(_CONNECT_LUA)
        self._disconnect = redis.register_script(_DISCONNECT_LUA)

    @classmethod
    def from_url(cls, url: str, *, ttl_seconds: int) -> "RedisPartyHub":
        return cls(Redis.from_url(url, decode_responses=True), ttl_seconds=ttl_seconds)

    # The braces are a Redis Cluster hash tag: all of a party's keys share a slot.
    def _state_key(self, code: str) -> str:
        return f"{self._prefix}:{{{code}}}:state"

    def _members_key(self, code: str) -> str:
        return f"{self._prefix}:{{{code}}}:members"

    def channel(self, code: str) -> str:
        return f"{self._prefix}:{{{code}}}:events"

    def _code_from_channel(self, channel: str) -> str | None:
        head = f"{self._prefix}:{{"
        if channel.startswith(head) and channel.endswith("}:events"):
            return channel[len(head) : -len("}:events")]
        return None

    async def get_state(self, code: str) -> PlaybackState:
        raw = await self._redis.hgetall(self._state_key(code))
        return parse_redis_state({_text(k): _text(v) for k, v in raw.items()})

    async def apply_control(
        self,
        code: str,
        *,
        action: ControlAction,
        position: float,
        rate: float | None,
        by: PartyUser,
        now: float,
    ) -> PlaybackState:
        raw = await self._apply(
            keys=[self._state_key(code)],
            args=[
                action,
                _json_float(position),
                "" if rate is None else _json_float(rate),
                _json_float(now),
                by.model_dump_json(),
                self._ttl,
                self.channel(code),
                _json_float(DEFAULT_RATE),
            ],
        )
        return PlaybackState.model_validate_json(raw)

    async def publish(self, code: str, event: Event) -> None:
        await self._redis.publish(self.channel(code), json.dumps(event))

    async def connect(self, code: str, user_id: uuid.UUID) -> int:
        count = await self._connect(
            keys=[self._members_key(code)], args=[str(user_id), self._ttl, self.channel(code)]
        )
        return int(count)

    async def disconnect(self, code: str, user_id: uuid.UUID) -> int:
        count = await self._disconnect(
            keys=[self._members_key(code)], args=[str(user_id), self.channel(code)]
        )
        return int(count)

    async def member_count(self, code: str) -> int:
        return int(await self._redis.hlen(self._members_key(code)))

    async def end(self, code: str) -> None:
        await self.publish(code, ENDED_EVENT)
        await self._redis.delete(self._state_key(code), self._members_key(code))

    @asynccontextmanager
    async def subscribe(self, code: str) -> AsyncIterator[Subscription]:
        sub = Subscription()
        lock = self._get_lock()
        async with lock:
            if self._fanout.closed:
                sub.deliver(None)
            elif self._fanout.add(code, sub):
                pubsub = self._get_pubsub()
                await pubsub.subscribe(self.channel(code))
                self._start_reader()
        try:
            yield sub
        finally:
            async with lock:
                if self._fanout.remove(code, sub) and self._pubsub is not None:
                    with contextlib.suppress(Exception):
                        await self._pubsub.unsubscribe(self.channel(code))

    async def close(self) -> None:
        self._fanout.close()
        if self._reader is not None:
            self._reader.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._reader
            self._reader = None
        if self._pubsub is not None:
            with contextlib.suppress(Exception):
                await self._pubsub.aclose()  # type: ignore[no-untyped-call]
            self._pubsub = None
        await self._redis.aclose()

    # -- pub/sub plumbing --------------------------------------------------------------

    def _get_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    def _get_pubsub(self) -> PubSub:
        if self._pubsub is None:
            self._pubsub = self._redis.pubsub(ignore_subscribe_messages=True)
        return self._pubsub

    def _start_reader(self) -> None:
        if self._wakeup is None:
            self._wakeup = asyncio.Event()
        self._wakeup.set()
        if self._reader is None or self._reader.done():
            self._reader = asyncio.create_task(self._read_loop(), name="party-hub-reader")

    async def _read_loop(self) -> None:
        assert self._wakeup is not None  # noqa: S101 - set by _start_reader
        while True:
            pubsub = self._pubsub
            if pubsub is None or not pubsub.subscribed:
                self._wakeup.clear()
                await self._wakeup.wait()
                continue
            try:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("parties.hub_read_failed", error=str(exc))
                await asyncio.sleep(1.0)
                continue
            if message is None or message.get("type") != "message":
                continue
            self._dispatch(_text(message["channel"]), message["data"])

    def _dispatch(self, channel: str, data: str | bytes) -> None:
        code = self._code_from_channel(channel)
        if code is None:
            return
        try:
            event = json.loads(data)
        except ValueError:
            logger.warning("parties.hub_bad_message", channel=channel)
            return
        if isinstance(event, dict):
            self._fanout.deliver(code, event)


def create_party_hub(settings: Settings) -> PartyHub:
    """Build the hub selected by ``APP_PARTY_HUB``. Redis connects lazily on first use."""
    if settings.party_hub == "memory":
        return InMemoryPartyHub(ttl_seconds=settings.party_ttl_seconds)
    return RedisPartyHub.from_url(settings.redis_url, ttl_seconds=settings.party_ttl_seconds)


def get_party_hub(conn: HTTPConnection) -> PartyHub:
    """The app-lifetime hub (created in ``create_app``, closed in the lifespan)."""
    hub: PartyHub = conn.app.state.party_hub
    return hub


PartyHubDep = Annotated[PartyHub, Depends(get_party_hub)]
