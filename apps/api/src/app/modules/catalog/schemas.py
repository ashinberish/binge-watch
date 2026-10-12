import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class ShowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    synopsis: str
    poster_url: str | None
    year: int | None


class EpisodeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    number: int
    title: str
    duration_seconds: int


class SeasonRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    number: int
    episodes: list[EpisodeRead]


class ShowDetail(ShowRead):
    seasons: list[SeasonRead]


class MatchRequest(BaseModel):
    """What a content script sees on a streaming site's player page."""

    provider: str = Field(
        pattern=r"^[a-z0-9-]{1,32}$", description="Streaming site key, e.g. `netflix`."
    )
    external_id: str = Field(
        min_length=1, max_length=255, description="The provider's own id for this episode."
    )
    show_title: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
    ]
    episode_title: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None
    ) = None
    season: int | None = Field(default=None, ge=0)
    episode: int | None = Field(default=None, ge=1)
    duration_seconds: int | None = Field(default=None, gt=0)


class NextEpisode(BaseModel):
    episode_id: uuid.UUID
    season_number: int
    episode_number: int
    title: str
    duration_seconds: int


class MatchResult(BaseModel):
    episode_id: uuid.UUID
    show_id: uuid.UUID
    show_title: str
    poster_url: str | None
    season_number: int
    episode_number: int
    episode_title: str
    duration_seconds: int
    next_episode: NextEpisode | None
