"""Liveness/readiness probes (mounted at the root, outside ``/api/v1``)."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.core.exceptions import ServiceUnavailableError, problem_responses
from app.core.logging import get_logger
from app.db.session import DbSession

logger = get_logger(__name__)

router = APIRouter(prefix="/health", tags=["health"])


class HealthStatus(BaseModel):
    status: Literal["ok"] = "ok"


class ReadinessStatus(BaseModel):
    status: Literal["ok"] = "ok"
    checks: dict[str, Literal["ok"]]


@router.get("/live", response_model=HealthStatus, operation_id="health_live")
async def live() -> HealthStatus:
    """Process is up."""
    return HealthStatus()


@router.get(
    "/ready",
    response_model=ReadinessStatus,
    operation_id="health_ready",
    responses=problem_responses(503),
)
async def ready(session: DbSession) -> ReadinessStatus:
    """Dependencies (database) are reachable."""
    try:
        await session.execute(text("SELECT 1"))
    except Exception as exc:
        logger.warning("health.database_unavailable", error=str(exc))
        raise ServiceUnavailableError("Database is unavailable.") from exc
    return ReadinessStatus(checks={"database": "ok"})
