import pytest
from pydantic import SecretStr, ValidationError

from app.core.config import Settings, get_settings


def test_cors_origins_from_comma_separated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_CORS_ORIGINS", "http://a.test, http://b.test")
    assert Settings().cors_origins == ["http://a.test", "http://b.test"]


def test_cors_origins_from_json_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_CORS_ORIGINS", '["http://a.test"]')
    assert Settings().cors_origins == ["http://a.test"]


def test_production_requires_real_secret() -> None:
    with pytest.raises(ValidationError, match="APP_JWT_SECRET"):
        Settings(environment="production")
    Settings(environment="production", jwt_secret=SecretStr("a-real-production-secret-12345678"))


def test_derived_urls() -> None:
    s = Settings(redis_url="redis://r:6379/1")
    assert s.broker_url == "redis://r:6379/1"
    assert s.result_backend == "redis://r:6379/1"
    assert not s.is_sqlite
    s = Settings(celery_broker_url="redis://b", celery_result_backend="redis://c")
    assert (s.broker_url, s.result_backend) == ("redis://b", "redis://c")


def test_get_settings_is_cached() -> None:
    assert get_settings() is get_settings()
