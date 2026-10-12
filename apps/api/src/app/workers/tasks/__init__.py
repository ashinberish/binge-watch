"""Celery task definitions."""

import asyncio

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.db.session import create_engine, create_sessionmaker
from app.modules.auth.repository import ExtensionCodeRepository, RefreshTokenRepository
from app.modules.auth.service import AuthService
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
