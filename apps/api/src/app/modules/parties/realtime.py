"""Watch-party WebSocket: in-band auth, then playback control, presence, chat and
reactions relayed through the hub.

See the "Watch parties" section of the README for the wire protocol.
"""

import asyncio
import contextlib
import json
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import IntEnum
from typing import Any

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketState

from app.api.deps import user_from_access_token
from app.core.config import Settings
from app.core.exceptions import NotFoundError
from app.core.logging import get_logger
from app.core.time import epoch_seconds, utcnow
from app.modules.catalog.repository import CatalogRepository
from app.modules.parties.hub import Event, PartyHub, Subscription
from app.modules.parties.repository import PartyRepository
from app.modules.parties.schemas import (
    AuthMessage,
    ChatMessage,
    ChatSendMessage,
    ControlMessage,
    PartyUser,
    PingMessage,
    Reaction,
    ReactMessage,
    StatusMessage,
    client_message_adapter,
)
from app.modules.parties.service import PartyService
from app.modules.users.repository import UserRepository

logger = get_logger(__name__)

AUTH_TIMEOUT_SECONDS = 5.0
IDLE_TIMEOUT_SECONDS = 60.0
CONTROL_RATE_PER_SECOND = 10.0
CONTROL_BURST = 10.0
# Chat and reaction limits are per user (across their sockets and API processes) and
# enforced by the hub; the control bucket above is per socket.
CHAT_RATE_LIMIT = 5
CHAT_RATE_WINDOW_SECONDS = 5.0
REACT_RATE_LIMIT = 3
REACT_RATE_WINDOW_SECONDS = 1.0
CHAT_RATE_LIMITED_DETAIL = "You're sending messages too quickly."
MAX_MESSAGE_CHARS = 8192


class CloseCode(IntEnum):
    SERVICE_RESTART = 1012
    INTERNAL_ERROR = 1011
    UNAUTHORIZED = 4401
    FORBIDDEN = 4403
    NOT_FOUND = 4404
    IDLE_TIMEOUT = 4408
    ENDED = 4410


@dataclass(frozen=True, slots=True)
class Close:
    code: CloseCode
    reason: str


def origin_allowed(origin: str | None, settings: Settings) -> bool:
    """Browsers always send Origin on WebSocket upgrades; non-browser clients may not."""
    if origin is None:
        return True
    if origin in settings.cors_origins:
        return True
    pattern = settings.cors_origin_regex
    return bool(pattern and re.fullmatch(pattern, origin))


class TokenBucket:
    """Allows ``rate`` events per second with bursts up to ``capacity``."""

    def __init__(self, rate: float, capacity: float) -> None:
        self.rate = rate
        self.capacity = capacity
        self.tokens = capacity
        self.updated = time.monotonic()

    def take(self, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False


async def _receive_text(websocket: WebSocket) -> str | None:
    """Next text frame; None for a binary frame. Raises WebSocketDisconnect on close."""
    message = await websocket.receive()
    if message["type"] == "websocket.disconnect":
        raise WebSocketDisconnect(message.get("code", 1000), message.get("reason"))
    text = message.get("text")
    return text if isinstance(text, str) else None


def _describe(exc: ValidationError) -> str:
    err = exc.errors()[0]
    loc = ".".join(str(part) for part in err.get("loc", ()))
    return f"{loc}: {err['msg']}" if loc else str(err["msg"])


@dataclass(frozen=True, slots=True)
class _Admission:
    user: PartyUser
    code: str
    expires_at: datetime
    is_host: bool


class PartyConnection:
    def __init__(
        self,
        websocket: WebSocket,
        code: str,
        *,
        hub: PartyHub,
        settings: Settings,
        sessionmaker: async_sessionmaker[AsyncSession],
    ) -> None:
        self.websocket = websocket
        self.requested_code = code
        self.hub = hub
        self.settings = settings
        self.sessionmaker = sessionmaker
        self._send_lock = asyncio.Lock()
        self._bucket = TokenBucket(CONTROL_RATE_PER_SECOND, CONTROL_BURST)
        self._last_seq = 0

    async def serve(self) -> None:
        await self.websocket.accept()
        if not origin_allowed(self.websocket.headers.get("origin"), self.settings):
            await self._close(Close(CloseCode.FORBIDDEN, "origin not allowed"))
            return
        try:
            outcome = await self._admit()
        except WebSocketDisconnect:
            return
        if isinstance(outcome, Close):
            await self._close(outcome)
            return
        await self._run(outcome)

    async def _admit(self) -> _Admission | Close:
        try:
            raw = await asyncio.wait_for(_receive_text(self.websocket), AUTH_TIMEOUT_SECONDS)
        except TimeoutError:
            return Close(CloseCode.UNAUTHORIZED, "authentication timed out")
        try:
            message = client_message_adapter.validate_json(raw or "")
        except ValidationError:
            message = None
        if not isinstance(message, AuthMessage):
            return Close(CloseCode.UNAUTHORIZED, "first message must be auth")

        async with self.sessionmaker() as session:
            user = await user_from_access_token(
                message.access_token, UserRepository(session), self.settings
            )
            if user is None:
                return Close(CloseCode.UNAUTHORIZED, "invalid or expired access token")
            service = PartyService(
                PartyRepository(session), CatalogRepository(session), self.hub, self.settings
            )
            try:
                party = await service.get_active(self.requested_code)
            except NotFoundError:
                return Close(CloseCode.NOT_FOUND, "party not found or no longer active")
            if not await service.is_member(party, user.id):
                return Close(CloseCode.FORBIDDEN, "join the party first")
            return _Admission(
                user=PartyUser(id=user.id, display_name=user.display_name),
                code=party.code,
                expires_at=party.expires_at,
                is_host=party.host_user_id == user.id,
            )

    async def _run(self, admission: _Admission) -> None:
        code, me = admission.code, admission.user
        log = logger.bind(party_code=code, user_id=str(me.id))
        await self.hub.connect(code, me, is_host=admission.is_host, now=epoch_seconds())
        log.info("parties.ws_connected")
        outcome: Close | None = None
        try:
            async with self.hub.subscribe(code) as sub:
                state = await self.hub.get_state(code)
                self._last_seq = state.seq
                await self._send(
                    {
                        "type": "welcome",
                        "state": state.model_dump(mode="json"),
                        "members": await self.hub.member_count(code),
                        "you": me.model_dump(mode="json"),
                        "members_list": [
                            m.model_dump(mode="json") for m in await self.hub.presence(code)
                        ],
                        "chat": [
                            m.model_dump(mode="json") for m in await self.hub.chat_history(code)
                        ],
                    }
                )
                outcome = await self._pump(code, me, sub, admission.expires_at)
        except WebSocketDisconnect:
            outcome = None
        except Exception:
            log.exception("parties.ws_failed")
            outcome = Close(CloseCode.INTERNAL_ERROR, "internal error")
        finally:
            with contextlib.suppress(Exception):
                await asyncio.shield(self.hub.disconnect(code, me.id))
            log.info("parties.ws_disconnected", close_code=outcome.code if outcome else None)
        if outcome is not None:
            await self._close(outcome)

    async def _pump(
        self, code: str, me: PartyUser, sub: Subscription, expires_at: datetime
    ) -> Close | None:
        tasks = {
            asyncio.create_task(self._read_client(code, me)),
            asyncio.create_task(self._forward_events(sub)),
            asyncio.create_task(self._expire_at(expires_at)),
        }
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        finished = done.pop()
        return finished.result()  # re-raises a task failure into _run

    async def _read_client(self, code: str, me: PartyUser) -> Close | None:
        while True:
            try:
                raw = await asyncio.wait_for(_receive_text(self.websocket), IDLE_TIMEOUT_SECONDS)
            except TimeoutError:
                return Close(CloseCode.IDLE_TIMEOUT, "no messages for too long")
            except WebSocketDisconnect:
                return None
            if raw is None:
                await self._error("expected a JSON text frame")
                continue
            if len(raw) > MAX_MESSAGE_CHARS:
                await self._error("message too large")
                continue
            try:
                message = client_message_adapter.validate_json(raw)
            except ValidationError as exc:
                await self._error(_describe(exc))
                continue
            if isinstance(message, PingMessage):
                await self._send({"type": "pong", "server_time": epoch_seconds()})
            elif isinstance(message, ControlMessage):
                if self._bucket.take():
                    await self.hub.apply_control(
                        code,
                        action=message.action,
                        position=message.position,
                        rate=message.rate,
                        by=me,
                        now=epoch_seconds(),
                    )
            elif isinstance(message, StatusMessage):
                await self.hub.set_status(code, me.id, message.status)
            elif isinstance(message, ChatSendMessage):
                chat = ChatMessage(
                    id=uuid.uuid4().hex, user=me, text=message.text, sent_at=epoch_seconds()
                )
                posted = await self.hub.post_chat(
                    code, chat, limit=CHAT_RATE_LIMIT, window=CHAT_RATE_WINDOW_SECONDS
                )
                if not posted:
                    await self._error(CHAT_RATE_LIMITED_DETAIL)
            elif isinstance(message, ReactMessage):
                reaction = Reaction(
                    id=uuid.uuid4().hex, kind=message.kind, user=me, at=epoch_seconds()
                )
                # Over the limit: silently dropped, like excess controls.
                await self.hub.react(
                    code, reaction, limit=REACT_RATE_LIMIT, window=REACT_RATE_WINDOW_SECONDS
                )
            elif isinstance(message, AuthMessage):
                await self._error("already authenticated")

    async def _forward_events(self, sub: Subscription) -> Close:
        while True:
            event = await sub.get()
            if event is None:
                return Close(CloseCode.SERVICE_RESTART, "server shutting down")
            kind = event.get("type")
            if kind == "state":
                seq = int(event["state"]["seq"])
                if seq <= self._last_seq:
                    continue  # already reflected in the welcome or a later state
                self._last_seq = seq
                await self._send(event)
            elif kind in {"members", "presence", "chat", "reaction"}:
                await self._send(event)
            elif kind == "ended":
                await self._send(event)
                return Close(CloseCode.ENDED, "party ended")

    async def _expire_at(self, expires_at: datetime) -> Close:
        await asyncio.sleep(max(0.0, (expires_at - utcnow()).total_seconds()))
        await self._send({"type": "ended"})
        return Close(CloseCode.ENDED, "party expired")

    async def _error(self, detail: str) -> None:
        await self._send({"type": "error", "detail": detail})

    async def _send(self, payload: Event | dict[str, Any]) -> None:
        async with self._send_lock:
            await self.websocket.send_text(json.dumps(payload))

    async def _close(self, outcome: Close) -> None:
        if self.websocket.application_state == WebSocketState.DISCONNECTED:
            return
        with contextlib.suppress(Exception):
            await self.websocket.close(code=outcome.code, reason=outcome.reason)
