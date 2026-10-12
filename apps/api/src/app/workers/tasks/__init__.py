"""Celery task definitions."""

from app.core.logging import get_logger
from app.workers.celery_app import celery_app

logger = get_logger(__name__)


@celery_app.task(name="nightreel.ping")
def ping(message: str = "pong") -> str:
    """Example task: echoes ``message``. Useful as a worker liveness probe."""
    logger.info("worker.ping", message=message)
    return message
