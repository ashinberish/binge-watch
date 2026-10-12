"""Password hashing (argon2id) and JWT access/refresh token handling."""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import Settings
from app.core.time import utcnow

TokenType = Literal["access", "refresh"]

_hasher = PasswordHasher()


def configure_password_hasher(*, time_cost: int, memory_cost: int, parallelism: int) -> None:
    """Swap the global argon2 parameters (called once from the app factory)."""
    global _hasher
    _hasher = PasswordHasher(time_cost=time_cost, memory_cost=memory_cost, parallelism=parallelism)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def hash_token(token: str) -> str:
    """Deterministic digest for storing opaque/refresh tokens at rest."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class InvalidTokenError(Exception):
    """Raised when a JWT is malformed, expired, or of the wrong type."""


@dataclass(frozen=True, slots=True)
class IssuedToken:
    token: str
    jti: str
    expires_at: datetime
    expires_in: int


@dataclass(frozen=True, slots=True)
class TokenClaims:
    subject: uuid.UUID
    jti: str
    token_type: TokenType
    expires_at: datetime


def _create_token(
    subject: uuid.UUID, token_type: TokenType, ttl_seconds: int, settings: Settings
) -> IssuedToken:
    now = utcnow()
    expires_at = now + timedelta(seconds=ttl_seconds)
    jti = secrets.token_urlsafe(16)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "type": token_type,
        "jti": jti,
        "iss": settings.jwt_issuer,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(
        payload, settings.jwt_secret.get_secret_value(), algorithm=settings.jwt_algorithm
    )
    return IssuedToken(token=token, jti=jti, expires_at=expires_at, expires_in=ttl_seconds)


def create_access_token(subject: uuid.UUID, settings: Settings) -> IssuedToken:
    return _create_token(subject, "access", settings.access_token_ttl_seconds, settings)


def create_refresh_token(subject: uuid.UUID, settings: Settings) -> IssuedToken:
    return _create_token(subject, "refresh", settings.refresh_token_ttl_seconds, settings)


def decode_token(token: str, expected_type: TokenType, settings: Settings) -> TokenClaims:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            issuer=settings.jwt_issuer,
            options={"require": ["sub", "exp", "iat", "jti", "type"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidTokenError(str(exc)) from exc
    if payload.get("type") != expected_type:
        raise InvalidTokenError("unexpected token type")
    try:
        subject = uuid.UUID(str(payload["sub"]))
    except ValueError as exc:
        raise InvalidTokenError("invalid subject") from exc
    return TokenClaims(
        subject=subject,
        jti=str(payload["jti"]),
        token_type=expected_type,
        expires_at=datetime.fromtimestamp(int(payload["exp"]), tz=utcnow().tzinfo),
    )
