"""HTTP and WebSocket payloads for watch parties."""

import re
import uuid
from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator

PROVIDER_PATTERN = r"^[a-z0-9-]{1,32}$"

MIN_RATE = 0.25
MAX_RATE = 4.0
DEFAULT_RATE = 1.0

CHAT_MAX_CHARS = 500


# --- HTTP -------------------------------------------------------------------------------


def check_https_url(value: str) -> str:
    """Trimmed ``value`` if it is an https URL with a host and no credentials."""
    value = value.strip()
    try:
        parts = urlsplit(value)
        _ = parts.port  # raises ValueError for a malformed port
    except ValueError as exc:
        raise ValueError("must be a valid URL") from exc
    if parts.scheme != "https" or not parts.hostname:
        raise ValueError("must be an https:// URL")
    if parts.username is not None or parts.password is not None:
        raise ValueError("must not contain credentials")
    return value


class PartyCreate(BaseModel):
    provider: str = Field(
        pattern=PROVIDER_PATTERN,
        description="Streaming provider slug, e.g. `youtube`.",
        examples=["youtube"],
    )
    watch_url: str = Field(
        max_length=2048,
        description="HTTPS URL of the video. Its host must be on the server's allow-list "
        "(`APP_PARTY_ALLOWED_HOSTS`, default `www.youtube.com`).",
        examples=["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    )
    episode_id: uuid.UUID | None = Field(
        default=None, description="Catalog episode being watched, if known."
    )

    @field_validator("watch_url")
    @classmethod
    def _https_url(cls, value: str) -> str:
        return check_https_url(value)


class PartyUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str


class PartyRead(BaseModel):
    id: uuid.UUID
    code: str = Field(description="Invite code (10 characters).")
    invite_url: str = Field(description="Web link friends open to join: `{web_url}/party/{code}`.")
    provider: str
    watch_url: str
    episode_id: uuid.UUID | None
    host: PartyUser
    member_count: int = Field(description="Viewers who have joined (and not left).")
    expires_at: datetime
    created_at: datetime


# --- WebSocket wire format --------------------------------------------------------------


class PlaybackState(BaseModel):
    """Authoritative playback state of a room.

    A client's expected position is
    `position + (0 if paused else (server_now - updated_at) * rate)`.
    """

    paused: bool = True
    position: float = Field(default=0.0, description="Seconds into the video at `updated_at`.")
    rate: float = DEFAULT_RATE
    updated_at: float = Field(default=0.0, description="Server epoch seconds of the last change.")
    seq: int = Field(default=0, description="Increments by one on every accepted control.")
    by: PartyUser | None = Field(default=None, description="Who made the last change.")


def expected_position(state: PlaybackState, server_now: float) -> float:
    """Where playback should be at ``server_now`` (epoch seconds), never negative."""
    if state.paused:
        return max(0.0, state.position)
    elapsed = max(0.0, server_now - state.updated_at)
    return max(0.0, state.position + elapsed * state.rate)


ControlAction = Literal["play", "pause", "seek"]


class AuthMessage(BaseModel):
    type: Literal["auth"]
    access_token: str = Field(min_length=1, max_length=4096)


class ControlMessage(BaseModel):
    type: Literal["control"]
    action: ControlAction
    position: float = Field(ge=0, allow_inf_nan=False)
    rate: float | None = Field(default=None, ge=MIN_RATE, le=MAX_RATE, allow_inf_nan=False)


class PartyVideo(BaseModel):
    """The video a party is watching (``video`` in the wire docs)."""

    watch_url: str
    provider: str
    episode_id: uuid.UUID | None = None


class VideoMessage(BaseModel):
    """Switch the party to another video (validated like ``PartyCreate``)."""

    type: Literal["video"]
    watch_url: str = Field(max_length=2048)
    provider: str = Field(pattern=PROVIDER_PATTERN)
    episode_id: uuid.UUID | None = None

    @field_validator("watch_url")
    @classmethod
    def _https_url(cls, value: str) -> str:
        return check_https_url(value)

    def video(self) -> PartyVideo:
        return PartyVideo(
            watch_url=self.watch_url, provider=self.provider, episode_id=self.episode_id
        )


class PingMessage(BaseModel):
    type: Literal["ping"]


PresenceStatus = Literal["watching", "buffering", "ad", "away"]
ReactionKind = Literal["heart", "laugh", "wow", "fire", "clap", "sad"]

DEFAULT_PRESENCE_STATUS: PresenceStatus = "watching"

_WHITESPACE = re.compile(r"\s+")
# C0/C1 controls, plus bidi embedding/override/isolate marks (text-direction spoofing).
# Zero-width joiners stay: emoji sequences need them.
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]")


def clean_chat_text(text: str) -> str:
    """Collapse whitespace runs (newlines included) to one space, drop control
    characters and trim. Raises ValueError unless 1..500 characters remain."""
    cleaned = _CONTROL_CHARS.sub("", _WHITESPACE.sub(" ", text)).strip()
    cleaned = _WHITESPACE.sub(" ", cleaned)
    if not cleaned:
        raise ValueError("message is empty")
    if len(cleaned) > CHAT_MAX_CHARS:
        raise ValueError(f"message is longer than {CHAT_MAX_CHARS} characters")
    return cleaned


class PresenceMember(BaseModel):
    """One connected viewer in the live member list (``Member`` in the wire docs)."""

    id: uuid.UUID
    display_name: str
    is_host: bool
    status: PresenceStatus = DEFAULT_PRESENCE_STATUS
    joined_at: float = Field(description="Server epoch seconds of the first connect.")


def sort_members(members: list[PresenceMember]) -> list[PresenceMember]:
    """Host first, then by first-connect time (user id breaks ties)."""
    return sorted(members, key=lambda m: (not m.is_host, m.joined_at, str(m.id)))


class ChatMessage(BaseModel):
    """A chat line as broadcast and kept in the (ephemeral) room history."""

    id: str
    user: PartyUser
    text: str
    sent_at: float = Field(description="Server epoch seconds.")


class Reaction(BaseModel):
    """A one-off emoji reaction (broadcast as ``{"type": "reaction", ...}``, never stored)."""

    id: str
    kind: ReactionKind
    user: PartyUser
    at: float = Field(description="Server epoch seconds.")


class StatusMessage(BaseModel):
    type: Literal["status"]
    status: PresenceStatus


class ChatSendMessage(BaseModel):
    type: Literal["chat"]
    text: str

    @field_validator("text")
    @classmethod
    def _clean(cls, value: str) -> str:
        return clean_chat_text(value)


class ReactMessage(BaseModel):
    type: Literal["react"]
    kind: ReactionKind


AnyClientMessage = (
    AuthMessage
    | ControlMessage
    | PingMessage
    | StatusMessage
    | ChatSendMessage
    | ReactMessage
    | VideoMessage
)
ClientMessage = Annotated[AnyClientMessage, Field(discriminator="type")]
client_message_adapter: TypeAdapter[AnyClientMessage] = TypeAdapter(ClientMessage)
