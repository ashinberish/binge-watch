"""Realtime room state and fan-out for watch parties.

``PartyHub`` is the seam that lets the API scale out: the WebSocket handler only talks to
the hub, never to other connections directly.

- ``RedisPartyHub`` (default, ``APP_PARTY_HUB=redis``): playback state, connections,
  presence and chat history live in Redis (with the party TTL); every mutation runs as one
  Lua script that also ``PUBLISH``es the resulting event, so ``seq`` order and broadcast
  order agree across all API processes. Each process holds a single pub/sub connection and
  fans messages out to its local subscribers.
- ``InMemoryPartyHub`` (``APP_PARTY_HUB=memory``): the same contract within one process,
  for tests and single-process development.

Events delivered to subscribers are exactly the server→client WebSocket messages:
``state``, ``members``, ``presence``, ``chat``, ``reaction`` and ``ended``.

Crash safety: every connection is recorded with the id of the API process holding it, and
each process keeps a heartbeat key alive (``{prefix}:proc:{proc_id}``, refreshed every
15 s, TTL 45 s). Counts and presence ignore connections of processes whose key is gone,
and the next mutation (or a heartbeat sweep) deletes them and re-broadcasts, so a crashed
process's viewers disappear within about a minute instead of lingering until the party TTL.

Chat history is deliberately ephemeral: the last 50 lines live only in the hub (Redis list
or memory) and vanish when the party ends or its TTL runs out; nothing reaches Postgres.
"""

import asyncio
import contextlib
import json
import time
import uuid
from collections import Counter, deque
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from typing import Annotated, Any, Literal, Protocol

from fastapi import Depends
from redis.asyncio import Redis
from redis.asyncio.client import PubSub
from starlette.requests import HTTPConnection

from app.core.config import Settings
from app.core.logging import get_logger
from app.modules.parties.schemas import (
    DEFAULT_PRESENCE_STATUS,
    DEFAULT_RATE,
    ChatMessage,
    ControlAction,
    PartyUser,
    PlaybackState,
    PresenceMember,
    PresenceStatus,
    Reaction,
    sort_members,
)

logger = get_logger(__name__)

Event = dict[str, Any]

SUBSCRIPTION_QUEUE_SIZE = 256
CHAT_HISTORY_SIZE = 50
PRESENCE_COALESCE_SECONDS = 0.1
PROC_HEARTBEAT_SECONDS = 15.0
PROC_TTL_SECONDS = 45

RateKind = Literal["chat", "react"]


def members_event(count: int) -> Event:
    return {"type": "members", "count": count}


def state_event(state: PlaybackState) -> Event:
    return {"type": "state", "state": state.model_dump(mode="json")}


def presence_event(members: list[PresenceMember]) -> Event:
    return {"type": "presence", "members": [m.model_dump(mode="json") for m in members]}


def chat_event(message: ChatMessage) -> Event:
    return {"type": "chat", "message": message.model_dump(mode="json")}


def reaction_event(reaction: Reaction) -> Event:
    return {"type": "reaction", **reaction.model_dump(mode="json")}


ENDED_EVENT: Event = {"type": "ended"}

# Hub-internal signal (never sent to clients): "the member list of this party changed".
# Each process re-reads the list after a short coalescing delay and fans it out locally,
# so the last presence frame always reflects the latest hub state, whichever process wrote.
PRESENCE_CHANGED = "presence_changed"


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

    def has(self, code: str) -> bool:
        return code in self._subs

    def codes(self) -> list[str]:
        return list(self._subs)

    def close(self) -> None:
        """Wake every listener with the end-of-stream marker (app shutdown)."""
        self.closed = True
        for subs in self._subs.values():
            for sub in subs:
                sub.deliver(None)


class PresenceNotifier:
    """Coalesces "member list changed" signals into one ``presence`` frame per party.

    A signal marks the party dirty; after ``delay`` seconds the list is loaded from the hub
    and delivered to this process's subscribers. Signals arriving meanwhile are folded into
    that load, or trigger one more, so the last frame always reflects the latest state.
    """

    def __init__(
        self,
        fanout: LocalFanout,
        load: Callable[[str], Awaitable[list[PresenceMember]]],
        delay: float,
    ) -> None:
        self._fanout = fanout
        self._load = load
        self.delay = delay
        self._dirty: set[str] = set()
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def schedule(self, code: str) -> None:
        if self._fanout.closed:
            return
        self._dirty.add(code)
        if code not in self._tasks:
            self._tasks[code] = asyncio.create_task(self._run(code), name="party-presence")

    async def _run(self, code: str) -> None:
        try:
            while code in self._dirty:
                await asyncio.sleep(self.delay)
                self._dirty.discard(code)
                if not self._fanout.has(code):
                    continue
                try:
                    members = await self._load(code)
                except Exception as exc:
                    logger.warning("parties.presence_load_failed", error=str(exc))
                    continue
                self._fanout.deliver(code, presence_event(members))
        finally:
            self._tasks.pop(code, None)

    async def close(self) -> None:
        self._dirty.clear()
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


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

    async def connect(self, code: str, user: PartyUser, *, is_host: bool, now: float) -> int:
        """Count a connection of ``user`` (listing them in presence as ``watching`` on
        their first one); broadcast and return the connected-member count."""
        ...

    async def disconnect(self, code: str, user_id: uuid.UUID) -> int:
        """Undo one ``connect`` (dropping the user from presence after their last one);
        broadcast and return the connected-member count."""
        ...

    async def member_count(self, code: str) -> int:
        """Distinct users with at least one open connection on a live process."""
        ...

    async def presence(self, code: str) -> list[PresenceMember]:
        """Connected users, host first, then by first-connect time."""
        ...

    async def set_status(self, code: str, user_id: uuid.UUID, status: PresenceStatus) -> bool:
        """Set a connected user's status (broadcast if it changed); False if not present."""
        ...

    async def post_chat(
        self, code: str, message: ChatMessage, *, limit: int, window: float
    ) -> bool:
        """Append to the history (last 50) and broadcast, unless the author already sent
        ``limit`` messages in the last ``window`` seconds (then False, nothing happens)."""
        ...

    async def chat_history(self, code: str) -> list[ChatMessage]:
        """Recent chat, oldest first."""
        ...

    async def react(self, code: str, reaction: Reaction, *, limit: int, window: float) -> bool:
        """Broadcast a reaction (not stored) unless rate limited like ``post_chat``."""
        ...

    async def sweep(self, code: str) -> int:
        """Forget connections held by dead API processes (broadcasting if any were);
        return the connected-member count."""
        ...

    async def end(self, code: str) -> None:
        """Broadcast ``ended`` and drop the party's realtime state."""
        ...

    async def close(self) -> None:
        """Release resources; open subscriptions receive end-of-stream."""
        ...


@dataclass(slots=True)
class _Presence:
    user: PartyUser
    is_host: bool
    status: PresenceStatus


class InMemoryPartyHub:
    """Single-process hub. All mutations are synchronous between awaits, hence atomic.

    Connections are keyed by ``(user_id, proc_id)`` like in Redis, so the stale-process
    cleanup behaves the same (a hub's own ``proc_id`` is always alive; other ids are alive
    while their deadline in ``_procs`` is in the future).
    """

    def __init__(
        self, *, ttl_seconds: int, presence_delay: float = PRESENCE_COALESCE_SECONDS
    ) -> None:
        self._ttl = ttl_seconds
        self.proc_id = uuid.uuid4().hex
        self._procs: dict[str, float] = {}
        self._states: dict[str, tuple[PlaybackState, float]] = {}
        self._conns: dict[str, Counter[tuple[uuid.UUID, str]]] = {}
        self._presence: dict[str, dict[uuid.UUID, _Presence]] = {}
        self._joined: dict[str, dict[uuid.UUID, float]] = {}
        self._chat: dict[str, tuple[deque[ChatMessage], float]] = {}
        self._rates: dict[tuple[str, RateKind, uuid.UUID], deque[float]] = {}
        self._fanout = LocalFanout()
        self._notifier = PresenceNotifier(self._fanout, self.presence, presence_delay)

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

    # -- connections & presence ----------------------------------------------------------

    def _alive(self, proc_id: str) -> bool:
        if proc_id == self.proc_id:
            return True
        deadline = self._procs.get(proc_id)
        return deadline is not None and deadline > time.monotonic()

    def _live_users(self, code: str) -> set[uuid.UUID]:
        return {uid for uid, proc in self._conns.get(code, ()) if self._alive(proc)}

    def _prune(self, code: str) -> bool:
        """Drop connections of dead processes, then presence of users with none left."""
        changed = False
        conns = self._conns.get(code)
        if conns is not None:
            for key in [k for k in conns if not self._alive(k[1])]:
                del conns[key]
                changed = True
            if not conns:
                del self._conns[code]
        live = self._live_users(code)
        present = self._presence.get(code)
        if present is not None:
            for uid in [u for u in present if u not in live]:
                del present[uid]
                changed = True
            if not present:
                del self._presence[code]
        return changed

    def _broadcast_members(self, code: str) -> int:
        count = len(self._live_users(code))
        self._fanout.deliver(code, members_event(count))
        self._notifier.schedule(code)
        return count

    async def connect(self, code: str, user: PartyUser, *, is_host: bool, now: float) -> int:
        self._prune(code)
        self._conns.setdefault(code, Counter())[(user.id, self.proc_id)] += 1
        present = self._presence.setdefault(code, {})
        previous = present.get(user.id)
        status = previous.status if previous is not None else DEFAULT_PRESENCE_STATUS
        present[user.id] = _Presence(user=user, is_host=is_host, status=status)
        self._joined.setdefault(code, {}).setdefault(user.id, now)
        return self._broadcast_members(code)

    async def disconnect(self, code: str, user_id: uuid.UUID) -> int:
        conns = self._conns.get(code)
        key = (user_id, self.proc_id)
        if conns is not None and key in conns:
            conns[key] -= 1
            if conns[key] <= 0:
                del conns[key]
        self._prune(code)
        return self._broadcast_members(code)

    async def member_count(self, code: str) -> int:
        return len(self._live_users(code))

    async def presence(self, code: str) -> list[PresenceMember]:
        live = self._live_users(code)
        joined = self._joined.get(code, {})
        return sort_members(
            [
                PresenceMember(
                    id=uid,
                    display_name=entry.user.display_name,
                    is_host=entry.is_host,
                    status=entry.status,
                    joined_at=joined.get(uid, 0.0),
                )
                for uid, entry in self._presence.get(code, {}).items()
                if uid in live
            ]
        )

    async def set_status(self, code: str, user_id: uuid.UUID, status: PresenceStatus) -> bool:
        entry = self._presence.get(code, {}).get(user_id)
        if entry is None or user_id not in self._live_users(code):
            return False
        if entry.status != status:
            entry.status = status
            self._notifier.schedule(code)
        return True

    async def sweep(self, code: str) -> int:
        if self._prune(code):
            return self._broadcast_members(code)
        return len(self._live_users(code))

    # -- chat & reactions ----------------------------------------------------------------

    def _allow(
        self, code: str, kind: RateKind, user_id: uuid.UUID, now: float, limit: int, window: float
    ) -> bool:
        """Sliding-window log: at most ``limit`` events per ``window`` seconds."""
        log = self._rates.setdefault((code, kind, user_id), deque())
        while log and log[0] <= now - window:
            log.popleft()
        if len(log) >= limit:
            return False
        log.append(now)
        return True

    async def post_chat(
        self, code: str, message: ChatMessage, *, limit: int, window: float
    ) -> bool:
        if not self._allow(code, "chat", message.user.id, message.sent_at, limit, window):
            return False
        entry = self._chat.get(code)
        history = (
            entry[0]
            if entry is not None and entry[1] > time.monotonic()
            else deque(maxlen=CHAT_HISTORY_SIZE)
        )
        history.append(message)
        self._chat[code] = (history, time.monotonic() + self._ttl)
        self._fanout.deliver(code, chat_event(message))
        return True

    async def chat_history(self, code: str) -> list[ChatMessage]:
        entry = self._chat.get(code)
        if entry is None or entry[1] <= time.monotonic():
            self._chat.pop(code, None)
            return []
        return list(entry[0])

    async def react(self, code: str, reaction: Reaction, *, limit: int, window: float) -> bool:
        if not self._allow(code, "react", reaction.user.id, reaction.at, limit, window):
            return False
        self._fanout.deliver(code, reaction_event(reaction))
        return True

    async def end(self, code: str) -> None:
        for store in (self._states, self._conns, self._presence, self._joined, self._chat):
            store.pop(code, None)
        for key in [k for k in self._rates if k[0] == code]:
            del self._rates[key]
        self._fanout.deliver(code, ENDED_EVENT)

    async def close(self) -> None:
        self._fanout.close()
        await self._notifier.close()


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

# Shared by the connection scripts. KEYS[1] = connections hash ("{user}|{proc}" -> open
# sockets), KEYS[2] = presence hash (user -> {"display_name","is_host"}), KEYS[3] = status
# hash (user -> status). Dead process ids are passed at the end of ARGV (the scripts never
# touch the heartbeat keys themselves: those live outside the party's hash slot).
_PRESENCE_PRELUDE = """
local function dead_procs(from)
  local dead = {}
  for i = from, #ARGV do dead[ARGV[i]] = true end
  return dead
end
local function live_users(dead)
  local users, n = {}, 0
  for _, field in ipairs(redis.call('HKEYS', KEYS[1])) do
    local sep = string.find(field, '|', 1, true)
    local uid, proc = field, ''
    if sep then
      uid = string.sub(field, 1, sep - 1)
      proc = string.sub(field, sep + 1)
    end
    if dead[proc] then
      redis.call('HDEL', KEYS[1], field)
    elseif not users[uid] then
      users[uid] = true
      n = n + 1
    end
  end
  for _, uid in ipairs(redis.call('HKEYS', KEYS[2])) do
    if not users[uid] then
      redis.call('HDEL', KEYS[2], uid)
      redis.call('HDEL', KEYS[3], uid)
    end
  end
  return n
end
local function publish_members(channel, n)
  redis.call('PUBLISH', channel, '{"type":"members","count":' .. n .. '}')
  redis.call('PUBLISH', channel, '{"type":"presence_changed"}')
end
"""

# KEYS[4] = joined hash (user -> first connect epoch). ARGV: field, user, info json, now,
# ttl, channel, default status, dead procs...
_CONNECT_LUA = (
    _PRESENCE_PRELUDE
    + """
local dead = dead_procs(8)
live_users(dead)
redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
redis.call('HSETNX', KEYS[3], ARGV[2], ARGV[7])
redis.call('HSETNX', KEYS[4], ARGV[2], ARGV[4])
for i = 1, 4 do redis.call('EXPIRE', KEYS[i], ARGV[5]) end
local n = live_users({})
publish_members(ARGV[6], n)
return n
"""
)

# ARGV: field, channel, dead procs...
_DISCONNECT_LUA = (
    _PRESENCE_PRELUDE
    + """
local dead = dead_procs(3)
local c = redis.call('HINCRBY', KEYS[1], ARGV[1], -1)
if c <= 0 then redis.call('HDEL', KEYS[1], ARGV[1]) end
local n = live_users(dead)
publish_members(ARGV[2], n)
return n
"""
)

# ARGV: channel, dead procs... Broadcasts only if something was removed.
_SWEEP_LUA = (
    _PRESENCE_PRELUDE
    + """
local before = redis.call('HLEN', KEYS[1]) + redis.call('HLEN', KEYS[2])
local n = live_users(dead_procs(2))
if redis.call('HLEN', KEYS[1]) + redis.call('HLEN', KEYS[2]) ~= before then
  publish_members(ARGV[1], n)
end
return n
"""
)

# KEYS[1] = presence, KEYS[2] = status. ARGV: user, status, channel, ttl.
_SET_STATUS_LUA = """
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then return 0 end
if redis.call('HGET', KEYS[2], ARGV[1]) ~= ARGV[2] then
  redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
  redis.call('EXPIRE', KEYS[2], ARGV[4])
  redis.call('PUBLISH', ARGV[3], '{"type":"presence_changed"}')
end
return 1
"""

# Sliding-window log in a list (newest first): at most `limit` entries newer than
# `now - window`. `now` is kept as the caller's string to avoid float reformatting.
_RATE_LIMIT_PRELUDE = """
local function allow(key, now, window, limit)
  local cutoff = tonumber(now) - window
  while true do
    local oldest = redis.call('LINDEX', key, -1)
    if oldest and tonumber(oldest) <= cutoff then
      redis.call('RPOP', key)
    else
      break
    end
  end
  if redis.call('LLEN', key) >= limit then return false end
  redis.call('LPUSH', key, now)
  redis.call('EXPIRE', key, math.ceil(window) + 1)
  return true
end
"""

# KEYS[1] = chat history list (newest first), KEYS[2] = author's rate log.
# ARGV: message json, ttl, channel, history size, now, window, limit.
_POST_CHAT_LUA = (
    _RATE_LIMIT_PRELUDE
    + """
if not allow(KEYS[2], ARGV[5], tonumber(ARGV[6]), tonumber(ARGV[7])) then return 0 end
redis.call('LPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[4]) - 1)
redis.call('EXPIRE', KEYS[1], ARGV[2])
redis.call('PUBLISH', ARGV[3], '{"type":"chat","message":' .. ARGV[1] .. '}')
return 1
"""
)

# KEYS[1] = sender's rate log. ARGV: event json, channel, now, window, limit.
_REACT_LUA = (
    _RATE_LIMIT_PRELUDE
    + """
if not allow(KEYS[1], ARGV[3], tonumber(ARGV[4]), tonumber(ARGV[5])) then return 0 end
redis.call('PUBLISH', ARGV[2], ARGV[1])
return 1
"""
)


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


def _split_field(field: str) -> tuple[str, str]:
    """``"{user}|{proc}"`` → (user, proc); a bare user id (pre-presence format) → (user, "")."""
    user, _, proc = field.partition("|")
    return user, proc


def _live_users(fields: Iterable[str], dead: Iterable[str]) -> set[str]:
    dead_set = set(dead)
    return {user for user, proc in map(_split_field, fields) if proc not in dead_set}


class RedisPartyHub:
    """Multi-process hub backed by Redis (party hashes + one pub/sub channel per party)."""

    def __init__(
        self,
        redis: "Redis",
        *,
        ttl_seconds: int,
        key_prefix: str = "nightreel:party",
        presence_delay: float = PRESENCE_COALESCE_SECONDS,
        heartbeat_seconds: float = PROC_HEARTBEAT_SECONDS,
    ) -> None:
        self._redis = redis
        self._ttl = ttl_seconds
        self._prefix = key_prefix
        self.proc_id = uuid.uuid4().hex
        self.heartbeat_seconds = heartbeat_seconds
        self._fanout = LocalFanout()
        self._notifier = PresenceNotifier(self._fanout, self.presence, presence_delay)
        self._pubsub: PubSub | None = None
        self._reader: asyncio.Task[None] | None = None
        self._heartbeat: asyncio.Task[None] | None = None
        self._lock: asyncio.Lock | None = None
        self._wakeup: asyncio.Event | None = None
        self._apply = redis.register_script(_APPLY_CONTROL_LUA)
        self._connect = redis.register_script(_CONNECT_LUA)
        self._disconnect = redis.register_script(_DISCONNECT_LUA)
        self._sweep = redis.register_script(_SWEEP_LUA)
        self._set_status = redis.register_script(_SET_STATUS_LUA)
        self._post_chat = redis.register_script(_POST_CHAT_LUA)
        self._react = redis.register_script(_REACT_LUA)

    @classmethod
    def from_url(cls, url: str, *, ttl_seconds: int) -> "RedisPartyHub":
        return cls(Redis.from_url(url, decode_responses=True), ttl_seconds=ttl_seconds)

    # The braces are a Redis Cluster hash tag: all of a party's keys share a slot.
    def _key(self, code: str, name: str) -> str:
        return f"{self._prefix}:{{{code}}}:{name}"

    def _state_key(self, code: str) -> str:
        return self._key(code, "state")

    def _members_key(self, code: str) -> str:
        return self._key(code, "members")

    def _presence_keys(self, code: str) -> list[str]:
        """members, presence, status (the order the connection scripts expect)."""
        return [self._members_key(code), self._key(code, "presence"), self._key(code, "status")]

    def _joined_key(self, code: str) -> str:
        return self._key(code, "joined")

    def _chat_key(self, code: str) -> str:
        return self._key(code, "chat")

    def _rate_key(self, code: str, kind: RateKind, user_id: uuid.UUID) -> str:
        return self._key(code, f"rate:{kind}:{user_id}")

    def proc_key(self, proc_id: str) -> str:
        return f"{self._prefix}:proc:{proc_id}"

    def channel(self, code: str) -> str:
        return self._key(code, "events")

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

    # -- connections & presence ----------------------------------------------------------

    async def _connection_fields(self, code: str) -> list[str]:
        return [_text(f) for f in await self._redis.hkeys(self._members_key(code))]

    async def _dead_procs(self, fields: Iterable[str]) -> list[str]:
        """Process ids holding connections in ``fields`` whose heartbeat key is gone."""
        procs = sorted({proc for _, proc in map(_split_field, fields) if proc} - {self.proc_id})
        if not procs:
            return []
        async with self._redis.pipeline(transaction=False) as pipe:
            for proc in procs:
                pipe.exists(self.proc_key(proc))
            alive = await pipe.execute()
        return [proc for proc, exists in zip(procs, alive, strict=True) if not exists]

    async def _beat(self) -> None:
        await self._redis.set(self.proc_key(self.proc_id), "1", ex=PROC_TTL_SECONDS)

    async def _keep_alive(self) -> None:
        """Refresh this process's heartbeat key and make sure the refresh loop runs."""
        await self._beat()
        if not self._fanout.closed and (self._heartbeat is None or self._heartbeat.done()):
            self._heartbeat = asyncio.create_task(self._heartbeat_loop(), name="party-heartbeat")

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(self.heartbeat_seconds)
            try:
                await self._beat()
                for code in self._fanout.codes():
                    await self.sweep(code)
            except Exception as exc:
                logger.warning("parties.hub_heartbeat_failed", error=str(exc))

    async def connect(self, code: str, user: PartyUser, *, is_host: bool, now: float) -> int:
        await self._keep_alive()
        dead = await self._dead_procs(await self._connection_fields(code))
        info = json.dumps({"display_name": user.display_name, "is_host": is_host})
        count = await self._connect(
            keys=[*self._presence_keys(code), self._joined_key(code)],
            args=[
                f"{user.id}|{self.proc_id}",
                str(user.id),
                info,
                _json_float(now),
                self._ttl,
                self.channel(code),
                DEFAULT_PRESENCE_STATUS,
                *dead,
            ],
        )
        return int(count)

    async def disconnect(self, code: str, user_id: uuid.UUID) -> int:
        dead = await self._dead_procs(await self._connection_fields(code))
        count = await self._disconnect(
            keys=self._presence_keys(code),
            args=[f"{user_id}|{self.proc_id}", self.channel(code), *dead],
        )
        return int(count)

    async def member_count(self, code: str) -> int:
        fields = await self._connection_fields(code)
        return len(_live_users(fields, await self._dead_procs(fields)))

    async def presence(self, code: str) -> list[PresenceMember]:
        members_key, presence_key, status_key = self._presence_keys(code)
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.hkeys(members_key)
            pipe.hgetall(presence_key)
            pipe.hgetall(status_key)
            pipe.hgetall(self._joined_key(code))
            raw_fields, infos, statuses, joined = await pipe.execute()
        fields = [_text(f) for f in raw_fields]
        live = _live_users(fields, await self._dead_procs(fields))
        members: list[PresenceMember] = []
        for raw_uid, raw_info in infos.items():
            uid = _text(raw_uid)
            if uid not in live:
                continue
            info = json.loads(raw_info)
            members.append(
                PresenceMember.model_validate(
                    {
                        "id": uid,
                        "display_name": info["display_name"],
                        "is_host": info["is_host"],
                        "status": _text(statuses.get(raw_uid, DEFAULT_PRESENCE_STATUS)),
                        "joined_at": float(joined.get(raw_uid, 0.0)),
                    }
                )
            )
        return sort_members(members)

    async def set_status(self, code: str, user_id: uuid.UUID, status: PresenceStatus) -> bool:
        _, presence_key, status_key = self._presence_keys(code)
        found = await self._set_status(
            keys=[presence_key, status_key],
            args=[str(user_id), status, self.channel(code), self._ttl],
        )
        return bool(int(found))

    async def sweep(self, code: str) -> int:
        fields = await self._connection_fields(code)
        dead = await self._dead_procs(fields)
        if not dead:
            return len(_live_users(fields, ()))
        count = await self._sweep(keys=self._presence_keys(code), args=[self.channel(code), *dead])
        logger.info("parties.hub_swept", party_code=code, dead_procs=len(dead))
        return int(count)

    # -- chat & reactions ----------------------------------------------------------------

    async def post_chat(
        self, code: str, message: ChatMessage, *, limit: int, window: float
    ) -> bool:
        posted = await self._post_chat(
            keys=[self._chat_key(code), self._rate_key(code, "chat", message.user.id)],
            args=[
                message.model_dump_json(),
                self._ttl,
                self.channel(code),
                CHAT_HISTORY_SIZE,
                _json_float(message.sent_at),
                _json_float(window),
                limit,
            ],
        )
        return bool(int(posted))

    async def chat_history(self, code: str) -> list[ChatMessage]:
        raw = await self._redis.lrange(self._chat_key(code), 0, CHAT_HISTORY_SIZE - 1)
        return [ChatMessage.model_validate_json(item) for item in reversed(raw)]

    async def react(self, code: str, reaction: Reaction, *, limit: int, window: float) -> bool:
        sent = await self._react(
            keys=[self._rate_key(code, "react", reaction.user.id)],
            args=[
                json.dumps(reaction_event(reaction)),
                self.channel(code),
                _json_float(reaction.at),
                _json_float(window),
                limit,
            ],
        )
        return bool(int(sent))

    async def end(self, code: str) -> None:
        await self.publish(code, ENDED_EVENT)
        await self._redis.delete(
            self._state_key(code),
            *self._presence_keys(code),
            self._joined_key(code),
            self._chat_key(code),
        )

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
        await self._notifier.close()
        for task in (self._reader, self._heartbeat):
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        self._reader = None
        if self._heartbeat is not None:
            self._heartbeat = None
            # Graceful shutdown: other processes drop our connections on their next look.
            with contextlib.suppress(Exception):
                await self._redis.delete(self.proc_key(self.proc_id))
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
        if not isinstance(event, dict):
            return
        if event.get("type") == PRESENCE_CHANGED:
            self._notifier.schedule(code)
        else:
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
