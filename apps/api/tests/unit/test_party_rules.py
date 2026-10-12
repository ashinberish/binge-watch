"""Pure watch-party rules: codes, expected position, origins, rate limiting, settings."""

import pytest

from app.core.config import Settings
from app.modules.parties.realtime import TokenBucket, origin_allowed
from app.modules.parties.schemas import PlaybackState, expected_position
from app.modules.parties.service import CODE_ALPHABET, generate_party_code, normalize_code


def test_code_alphabet_is_unambiguous() -> None:
    assert not set(CODE_ALPHABET) & set("01ilo")
    assert len(set(CODE_ALPHABET)) == len(CODE_ALPHABET) == 31


def test_generate_party_code() -> None:
    codes = {generate_party_code() for _ in range(2000)}
    assert len(codes) == 2000
    for code in codes:
        assert len(code) == 10
        assert set(code) <= set(CODE_ALPHABET)
    assert len(generate_party_code(4)) == 4


def test_normalize_code() -> None:
    assert normalize_code("  AbC23 ") == "abc23"


@pytest.mark.parametrize(
    ("state", "now", "expected"),
    [
        (PlaybackState(), 1000.0, 0.0),
        (PlaybackState(paused=True, position=42, updated_at=10), 1000.0, 42.0),
        (PlaybackState(paused=False, position=42, updated_at=10), 15.0, 47.0),
        (PlaybackState(paused=False, position=42, rate=2.0, updated_at=10), 15.0, 52.0),
        (PlaybackState(paused=False, position=42, rate=0.5, updated_at=10), 14.0, 44.0),
        # Clock skew never moves playback backwards past the anchor.
        (PlaybackState(paused=False, position=42, updated_at=10), 9.0, 42.0),
    ],
)
def test_expected_position(state: PlaybackState, now: float, expected: float) -> None:
    assert expected_position(state, now) == pytest.approx(expected)


def test_origin_allowed() -> None:
    settings = Settings(
        cors_origins=["http://localhost:5173"], cors_origin_regex="chrome-extension://[a-p]{32}"
    )
    assert origin_allowed(None, settings)
    assert origin_allowed("http://localhost:5173", settings)
    assert origin_allowed("chrome-extension://abcdefghijklmnopabcdefghijklmnop", settings)
    assert not origin_allowed("chrome-extension://abcdefghijklmnopabcdefghijklmnopX", settings)
    assert not origin_allowed("https://evil.example", settings)
    assert not origin_allowed("http://localhost:5173.evil.example", settings)
    no_regex = settings.model_copy(update={"cors_origin_regex": None})
    assert not origin_allowed("chrome-extension://abcdefghijklmnopabcdefghijklmnop", no_regex)


def test_token_bucket() -> None:
    bucket = TokenBucket(rate=10, capacity=10)
    start = bucket.updated
    assert [bucket.take(start) for _ in range(11)] == [True] * 10 + [False]
    assert bucket.take(start + 0.15)  # one token refilled (1.5 available)
    assert not bucket.take(start + 0.15)
    assert sum(bucket.take(start + 100 + i * 0.001) for i in range(20)) == 10  # capped


def test_party_settings_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_PARTY_ALLOWED_HOSTS", "www.youtube.com, vimeo.com")
    monkeypatch.setenv("APP_PARTY_TTL_HOURS", "0.5")
    monkeypatch.setenv("APP_PARTY_HUB", "memory")
    settings = Settings()
    assert settings.party_allowed_hosts == ["www.youtube.com", "vimeo.com"]
    assert settings.party_ttl_seconds == 1800
    assert settings.party_hub == "memory"
    monkeypatch.setenv("APP_PARTY_ALLOWED_HOSTS", '["a.example"]')
    assert Settings().party_allowed_hosts == ["a.example"]


def test_party_settings_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("APP_PARTY_HUB", "APP_PARTY_TTL_HOURS", "APP_PARTY_MAX_MEMBERS", "APP_WEB_URL"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.party_hub == "redis"
    assert settings.party_ttl_hours == 12
    assert settings.party_max_members == 20
    assert settings.party_allowed_hosts == ["www.youtube.com"]
    assert settings.web_url == "http://localhost:5173"
