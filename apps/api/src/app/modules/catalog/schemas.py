import uuid

from pydantic import BaseModel, ConfigDict


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
