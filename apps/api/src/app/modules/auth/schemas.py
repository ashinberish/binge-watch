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


EXTENSION_REDIRECT_URI_PATTERN = r"^https://[a-p]{32}\.chromiumapp\.org/.*$"


class ExtensionCodeRequest(BaseModel):
    redirect_uri: str = Field(
        max_length=2048,
        pattern=EXTENSION_REDIRECT_URI_PATTERN,
        description="The extension's `chrome.identity.getRedirectURL()` "
        "(`https://<extension-id>.chromiumapp.org/...`).",
        examples=["https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/callback"],
    )


class ExtensionCode(BaseModel):
    code: str = Field(description="Single-use code to pass to `POST /auth/extension-token`.")
    expires_in: int = Field(description="Code lifetime in seconds.")


class ExtensionTokenRequest(BaseModel):
    code: str = Field(min_length=1, max_length=256)
    redirect_uri: str = Field(
        min_length=1,
        max_length=2048,
        description="Must equal the `redirect_uri` the code was issued for.",
    )
