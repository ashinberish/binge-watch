import uuid
from datetime import timedelta

import jwt
import pytest
from pydantic import SecretStr

from app.core import security
from app.core.config import Settings
from app.core.time import utcnow


@pytest.fixture(autouse=True)
def fast_hasher() -> None:
    security.configure_password_hasher(time_cost=1, memory_cost=8, parallelism=1)


def test_password_round_trip() -> None:
    hashed = security.hash_password("s3cret-password")
    assert hashed.startswith("$argon2id$")
    assert security.verify_password("s3cret-password", hashed)
    assert not security.verify_password("wrong", hashed)


def test_verify_password_handles_garbage_hash() -> None:
    assert not security.verify_password("x", "not-a-hash")
    assert security.password_needs_rehash("not-a-hash")


def test_needs_rehash_when_params_change() -> None:
    hashed = security.hash_password("pw")
    assert not security.password_needs_rehash(hashed)
    security.configure_password_hasher(time_cost=2, memory_cost=16, parallelism=1)
    assert security.password_needs_rehash(hashed)


def test_hash_token_is_deterministic_sha256() -> None:
    assert security.hash_token("abc") == security.hash_token("abc")
    assert len(security.hash_token("abc")) == 64
    assert security.hash_token("abc") != security.hash_token("abd")


def test_access_token_round_trip(settings: Settings) -> None:
    user_id = uuid.uuid4()
    issued = security.create_access_token(user_id, settings)
    assert issued.expires_in == settings.access_token_ttl_seconds
    claims = security.decode_token(issued.token, "access", settings)
    assert claims.subject == user_id
    assert claims.jti == issued.jti
    assert claims.token_type == "access"


def test_token_type_is_enforced(settings: Settings) -> None:
    refresh = security.create_refresh_token(uuid.uuid4(), settings)
    with pytest.raises(security.InvalidTokenError):
        security.decode_token(refresh.token, "access", settings)
    assert security.decode_token(refresh.token, "refresh", settings).token_type == "refresh"


def test_refresh_tokens_are_unique(settings: Settings) -> None:
    user_id = uuid.uuid4()
    a = security.create_refresh_token(user_id, settings)
    b = security.create_refresh_token(user_id, settings)
    assert a.token != b.token


def test_wrong_secret_rejected(settings: Settings) -> None:
    issued = security.create_access_token(uuid.uuid4(), settings)
    other = settings.model_copy(update={"jwt_secret": SecretStr("x" * 40)})
    with pytest.raises(security.InvalidTokenError):
        security.decode_token(issued.token, "access", other)


def _encode(settings: Settings, **overrides: object) -> str:
    now = utcnow()
    payload: dict[str, object] = {
        "sub": str(uuid.uuid4()),
        "type": "access",
        "jti": "j",
        "iss": settings.jwt_issuer,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
    }
    payload.update(overrides)
    return jwt.encode(payload, settings.jwt_secret.get_secret_value(), algorithm="HS256")


def test_expired_token_rejected(settings: Settings) -> None:
    token = _encode(settings, exp=int((utcnow() - timedelta(minutes=1)).timestamp()))
    with pytest.raises(security.InvalidTokenError):
        security.decode_token(token, "access", settings)


def test_invalid_subject_rejected(settings: Settings) -> None:
    with pytest.raises(security.InvalidTokenError, match="subject"):
        security.decode_token(_encode(settings, sub="not-a-uuid"), "access", settings)


def test_wrong_issuer_rejected(settings: Settings) -> None:
    with pytest.raises(security.InvalidTokenError):
        security.decode_token(_encode(settings, iss="someone-else"), "access", settings)
