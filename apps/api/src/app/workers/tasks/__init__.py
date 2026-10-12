"""Celery task definitions."""

import asyncio

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.db.session import create_engine, create_sessionmaker
from app.modules.auth.repository import ExtensionCodeRepository, RefreshTokenRepository
from app.modules.auth.service import AuthService
from app.modules.catalog.repository import CatalogRepository
from app.modules.parties.hub import PartyHub, create_party_hub
from app.modules.parties.repository import PartyRepository
from app.modules.parties.service import PartyService
from app.modules.users.repository import UserRepository
from app.workers.celery_app import celery_app

logger = get_logger(__name__)


@celery_app.task(name="nightreel.ping")
def ping(message: str = "pong") -> str:
    """Example task: echoes ``message``. Useful as a worker liveness probe."""
    logger.info("worker.ping", message=message)
    return message


async def purge_extension_codes_async(settings: Settings | None = None) -> int:
    """Delete extension sign-in codes issued more than a day ago. Returns the count."""
    settings = settings or get_settings()
    engine = create_engine(settings)
    try:
        async with create_sessionmaker(engine)() as session:
            service = AuthService(
                UserRepository(session),
                RefreshTokenRepository(session),
                ExtensionCodeRepository(session),
                settings,
            )
            return await service.purge_extension_codes()
    finally:
        await engine.dispose()


@celery_app.task(name="nightreel.purge_extension_codes")
def purge_extension_codes() -> int:
    """Housekeeping: purge stale extension codes (not scheduled yet; run via beat later)."""
    deleted = asyncio.run(purge_extension_codes_async())
    logger.info("worker.extension_codes_purged", deleted=deleted)
    return deleted


async def end_expired_parties_async(
    settings: Settings | None = None, hub: PartyHub | None = None
) -> int:
    """Mark expired watch parties ended and notify their open sockets via the hub.

    Returns the number of parties ended. With ``APP_PARTY_HUB=redis`` the API processes'
    sockets receive ``{"type": "ended"}`` (they also close on their own at ``expires_at``).
    """
    settings = settings or get_settings()
    own_hub = hub is None
    party_hub = hub or create_party_hub(settings)
    engine = create_engine(settings)
    try:
        async with create_sessionmaker(engine)() as session:
            service = PartyService(
                PartyRepository(session), CatalogRepository(session), party_hub, settings
            )
            return len(await service.end_expired())
    finally:
        await engine.dispose()
        if own_hub:
            await party_hub.close()


@celery_app.task(name="nightreel.end_expired_parties")
def end_expired_parties() -> int:
    """Housekeeping: end watch parties past ``expires_at`` (scheduled every 5 min via beat)."""
    ended = asyncio.run(end_expired_parties_async())
    logger.info("worker.parties_expired", ended=ended)
    return ended
