import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProgressUpdate(BaseModel):
    position_seconds: int = Field(ge=0, description="Playback position; clamped to duration.")
    duration_seconds: int = Field(gt=0)


class WatchProgressRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    episode_id: uuid.UUID
    profile_id: uuid.UUID
    position_seconds: int
    duration_seconds: int
    completed: bool
    updated_at: datetime


class ContinueWatchingItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    episode_id: uuid.UUID
    show_id: uuid.UUID
    show_title: str
    poster_url: str | None
    season_number: int
    episode_number: int
    episode_title: str
    position_seconds: int
    duration_seconds: int
    updated_at: datetime
