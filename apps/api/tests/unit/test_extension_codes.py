"""Service-level tests for the extension sign-in code flow and its housekeeping."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.exceptions import UnauthorizedError
from app.core.security import hash_token
from app.modules.auth.models import ExtensionCode
from app.modules.auth.schemas import ExtensionTokenRequest
from app.workers.tasks import purge_extension_codes_async
from tests.unit.test_services import auth_service, make_user

REDIRECT = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/cb"


async def stored_codes(session: AsyncSession) -> int:
    return (await session.execute(select(func.count()).select_from(ExtensionCode))).scalar_one()


async def test_code_issue_and_exchange(session: AsyncSession, settings: Settings) -> None:
    service = auth_service(session, settings)
    user = await make_user(session, settings)
    issued = await service.create_extension_code(user.id, REDIRECT)
    assert issued.expires_in == settings.extension_code_ttl_seconds == 60

    record = await service.codes.get_by_hash(hash_token(issued.code))
    assert record is not None
    assert record.expires_at.tzinfo is not None
    assert not record.is_used

    pair = await service.exchange_extension_code(
        ExtensionTokenRequest(code=issued.code, redirect_uri=REDIRECT)
    )
    assert pair.token_type == "bearer"
    await session.refresh(record)
    assert record.is_used


async def test_claim_is_atomic(session: AsyncSession, settings: Settings) -> None:
    """A second claim of the same row fails even if the caller read it as unused."""
    service = auth_service(session, settings)
    user = await make_user(session, settings)
    issued = await service.create_extension_code(user.id, REDIRECT)
    record = await service.codes.get_by_hash(hash_token(issued.code))
    assert record is not None
    now = datetime.now(UTC)
    assert await service.codes.claim(record.id, now) is True
    assert await service.codes.claim(record.id, now) is False


async def test_claim_rejects_expired_code(session: AsyncSession, settings: Settings) -> None:
    service = auth_service(session, settings)
    user = await make_user(session, settings)
    issued = await service.create_extension_code(user.id, REDIRECT)
    record = await service.codes.get_by_hash(hash_token(issued.code))
    assert record is not None
    assert await service.codes.claim(record.id, record.expires_at + timedelta(seconds=1)) is False


async def test_exchange_lost_race_is_unauthorized(
    session: AsyncSession, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = auth_service(session, settings)
    user = await make_user(session, settings)
    issued = await service.create_extension_code(user.id, REDIRECT)

    async def lost_race(*_args: object) -> bool:
        return False

    monkeypatch.setattr(service.codes, "claim", lost_race)
    with pytest.raises(UnauthorizedError):
        await service.exchange_extension_code(
            ExtensionTokenRequest(code=issued.code, redirect_uri=REDIRECT)
        )


async def test_exchange_rejects_inactive_user(session: AsyncSession, settings: Settings) -> None:
    service = auth_service(session, settings)
    user = await make_user(session, settings)
    issued = await service.create_extension_code(user.id, REDIRECT)
    user.is_active = False
    await session.commit()
    with pytest.raises(UnauthorizedError):
        await service.exchange_extension_code(
            ExtensionTokenRequest(code=issued.code, redirect_uri=REDIRECT)
        )


async def test_purge_removes_only_day_old_codes(session: AsyncSession, settings: Settings) -> None:
    service = auth_service(session, settings)
    user = await make_user(session, settings)
    fresh = await service.create_extension_code(user.id, REDIRECT)
    old = await service.create_extension_code(user.id, REDIRECT)
    old_record = await service.codes.get_by_hash(hash_token(old.code))
    assert old_record is not None
    old_record.created_at = datetime.now(UTC) - timedelta(days=1, seconds=1)
    old_record.expires_at = old_record.created_at + timedelta(seconds=60)
    await session.commit()

    assert await service.purge_extension_codes() == 1
    assert await stored_codes(session) == 1
    assert await service.codes.get_by_hash(hash_token(fresh.code)) is not None


async def test_purge_task(session: AsyncSession, settings: Settings) -> None:
    service = auth_service(session, settings)
    user = await make_user(session, settings)
    issued = await service.create_extension_code(user.id, REDIRECT)
    record = await service.codes.get_by_hash(hash_token(issued.code))
    assert record is not None
    record.created_at = datetime.now(UTC) - timedelta(days=2)
    await session.commit()

    assert await purge_extension_codes_async(settings) == 1
    assert await stored_codes(session) == 0
