"""Celery application. Run with: ``uv run celery -A app.workers.celery_app worker -l info``."""

from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "nightreel",
    broker=settings.broker_url,
    backend=settings.result_backend,
    include=["app.workers.tasks"],
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
)
celery_app.conf.beat_schedule = {
    "end-expired-parties": {
        "task": "nightreel.end_expired_parties",
        "schedule": 300.0,
    },
}
