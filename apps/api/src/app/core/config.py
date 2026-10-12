"""Application settings, loaded from environment variables prefixed with ``APP_``."""

from functools import lru_cache
from typing import Annotated, Literal

from fastapi import Depends, Request
from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

DEFAULT_JWT_SECRET = "dev-insecure-change-me-0123456789abcdef"  # noqa: S105 - placeholder, rejected in production

Environment = Literal["local", "test", "staging", "production"]


class Settings(BaseSettings):
    """Typed runtime configuration. Every field maps to ``APP_<FIELD_NAME>``."""

    model_config = SettingsConfigDict(
        env_prefix="APP_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Nightreel API"
    app_version: str = "0.1.0"
    environment: Environment = "local"
    debug: bool = False

    log_level: str = "INFO"
    log_json: bool = True

    database_url: str = "postgresql+asyncpg://nightreel:nightreel@localhost:5432/nightreel"
    database_echo: bool = False
    database_pool_size: int = Field(default=5, ge=1)
    database_max_overflow: int = Field(default=10, ge=0)

    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str | None = None
    celery_result_backend: str | None = None

    jwt_secret: SecretStr = SecretStr(DEFAULT_JWT_SECRET)
    jwt_algorithm: str = "HS256"
    jwt_issuer: str = "nightreel-api"
    access_token_ttl_seconds: int = Field(default=15 * 60, gt=0)
    refresh_token_ttl_seconds: int = Field(default=30 * 24 * 60 * 60, gt=0)

    argon2_time_cost: int = Field(default=3, ge=1)
    argon2_memory_cost: int = Field(default=64 * 1024, ge=8)
    argon2_parallelism: int = Field(default=4, ge=1)

    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]
    cors_origin_regex: str | None = None

    sentry_dsn: SecretStr | None = None
    otel_exporter_otlp_endpoint: str | None = None

    tmdb_api_key: SecretStr | None = None
    tmdb_base_url: str = "https://api.themoviedb.org/3"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Accept a comma-separated string (``a,b``) or a JSON-style list."""
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith("["):
                import json

                return json.loads(stripped)
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def _check_production_secrets(self) -> "Settings":
        if (
            self.environment == "production"
            and self.jwt_secret.get_secret_value() == DEFAULT_JWT_SECRET
        ):
            raise ValueError("APP_JWT_SECRET must be set in production")
        return self

    @property
    def broker_url(self) -> str:
        return self.celery_broker_url or self.redis_url

    @property
    def result_backend(self) -> str:
        return self.celery_result_backend or self.redis_url

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings singleton (read once from the environment)."""
    return Settings()


def get_app_settings(request: Request) -> Settings:
    """Settings bound to the running app (lets tests inject their own)."""
    settings: Settings = request.app.state.settings
    return settings


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
