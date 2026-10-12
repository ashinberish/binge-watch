from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.modules.users.schemas import DisplayName


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: DisplayName


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class TokenPair(BaseModel):
    # Response-only model: document defaulted fields as required for the generated client.
    model_config = ConfigDict(json_schema_mode_override="serialization")

    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - OAuth2 token type, not a secret
    expires_in: int = Field(description="Access token lifetime in seconds.")
