import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.modules.profiles.models import DEFAULT_AVATAR_COLOR

ProfileName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]
HexColor = Annotated[
    str,
    StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$"),
    Field(description="Hex color, e.g. `#d32f23`.", examples=[DEFAULT_AVATAR_COLOR]),
]


class ProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    avatar_color: str
    is_kids: bool
    created_at: datetime


class ProfileCreate(BaseModel):
    name: ProfileName
    avatar_color: HexColor = DEFAULT_AVATAR_COLOR
    is_kids: bool = False


class ProfileUpdate(BaseModel):
    name: ProfileName | None = None
    avatar_color: HexColor | None = None
    is_kids: bool | None = None
