"""Service-level tests against a real (SQLite) session, bypassing HTTP."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.exceptions import ConflictError, NotFoundError, UnauthorizedError
from app.core.security import create_refresh_token, hash_token
from app.modules.auth.repository import RefreshTokenRepository
from app.modules.auth.schemas import LoginRequest, RegisterRequest
from app.modules.auth.service import AuthService
from app.modules.profiles.repository import ProfileRepository
from app.modules.profiles.schemas import ProfileCreate, ProfileUpdate
from app.modules.profiles.service import ProfileService
from app.modules.streaks.repository import StreakRepository
from app.modules.streaks.service import StreakService
from app.modules.users.models import User
from app.modules.users.repository import UserRepository
from app.modules.users.schemas import UserUpdate
from app.modules.users.service import UserService


def auth_service(session: AsyncSession, settings: Settings) -> AuthService:
    return AuthService(UserRepository(session), RefreshTokenRepository(session), settings)


async def make_user(
    session: AsyncSession, settings: Settings, email: str = "a@example.com"
) -> User:
    return await auth_service(session, settings).register(
        RegisterRequest(email=email, password="password123", display_name="A")
    )


async def test_register_and_login(session: AsyncSession, settings: Settings) -> None:
    service = auth_service(session, settings)
    user = await make_user(session, settings)
    assert user.email == "a@example.com"
    assert user.password_hash != "password123"
    pair = await service.login(LoginRequest(email="A@example.com", password="password123"))
    assert pair.token_type == "bearer"
    with pytest.raises(ConflictError):
        await make_user(session, settings)


async def test_login_rejects_inactive_user(session: AsyncSession, settings: Settings) -> None:
    user = await make_user(session, settings)
    user.is_active = False
    await session.commit()
    with pytest.raises(UnauthorizedError):
        await auth_service(session, settings).login(
            LoginRequest(email="a@example.com", password="password123")
        )


async def test_refresh_rejects_expired_and_orphaned_tokens(
    session: AsyncSession, settings: Settings
) -> None:
    service = auth_service(session, settings)
    await make_user(session, settings)
    pair = await service.login(LoginRequest(email="a@example.com", password="password123"))

    record = await service.tokens.get_by_hash(hash_token(pair.refresh_token))
    assert record is not None
    record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await session.commit()
    with pytest.raises(UnauthorizedError, match="expired"):
        await service.refresh(pair.refresh_token)


async def test_refresh_rejects_unknown_but_valid_jwt(
    session: AsyncSession, settings: Settings
) -> None:
    token = create_refresh_token(uuid.uuid4(), settings).token
    with pytest.raises(UnauthorizedError):
        await auth_service(session, settings).refresh(token)


async def test_user_update(session: AsyncSession, settings: Settings) -> None:
    user = await make_user(session, settings)
    updated = await UserService(UserRepository(session)).update(
        user, UserUpdate(display_name="Renamed")
    )
    assert updated.display_name == "Renamed"


async def test_profile_service_rules(session: AsyncSession, settings: Settings) -> None:
    user = await make_user(session, settings)
    other = await make_user(session, settings, "b@example.com")
    service = ProfileService(ProfileRepository(session))

    created = [await service.create(user.id, ProfileCreate(name=f"P{i}")) for i in range(5)]
    with pytest.raises(ConflictError):
        await service.create(user.id, ProfileCreate(name="too many"))

    assert [p.id for p in await service.list_for_user(user.id)] == [p.id for p in created]
    assert await service.list_for_user(other.id) == []

    with pytest.raises(NotFoundError):
        await service.get_owned(other.id, created[0].id)
    with pytest.raises(NotFoundError):
        await service.update(other.id, created[0].id, ProfileUpdate(name="hijack"))

    renamed = await service.update(user.id, created[0].id, ProfileUpdate(name="Renamed"))
    assert renamed.name == "Renamed"
    unchanged = await service.update(user.id, created[0].id, ProfileUpdate())
    assert unchanged.name == "Renamed"

    await service.delete(user.id, created[0].id)
    assert len(await service.list_for_user(user.id)) == 4


async def test_streak_service_across_days(session: AsyncSession, settings: Settings) -> None:
    user = await make_user(session, settings)
    profiles = ProfileService(ProfileRepository(session))
    profile = await profiles.create(user.id, ProfileCreate(name="Main"))
    service = StreakService(StreakRepository(session), profiles)

    day1 = datetime(2026, 3, 1, 23, 0, tzinfo=UTC)
    await service.record_completion(profile.id, day1)
    await service.record_completion(profile.id, day1 + timedelta(hours=2))  # next UTC day
    await session.commit()

    view = await service.get_current(user.id, profile.id, now=day1 + timedelta(hours=3))
    assert (view.current_days, view.longest_days, view.episodes_today) == (2, 2, 1)

    stale = await service.get_current(user.id, profile.id, now=day1 + timedelta(days=4))
    assert (stale.current_days, stale.longest_days, stale.episodes_today) == (0, 2, 0)

    with pytest.raises(NotFoundError):
        await service.get_current(uuid.uuid4(), profile.id)
