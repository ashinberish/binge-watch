"""Observability hooks (Sentry, OpenTelemetry).

Both integrations are optional and imported lazily: nothing happens unless the
corresponding setting is configured *and* the SDK is installed in the image.
"""

import importlib
from typing import Any

from fastapi import FastAPI

from app.core.config import Settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def _try_import(module: str) -> Any | None:
    try:
        return importlib.import_module(module)
    except ImportError:
        logger.warning("telemetry.sdk_missing", module=module)
        return None


def setup_telemetry(app: FastAPI, settings: Settings) -> None:
    if settings.sentry_dsn is not None:
        sentry_sdk = _try_import("sentry_sdk")
        if sentry_sdk is not None:
            sentry_sdk.init(
                dsn=settings.sentry_dsn.get_secret_value(),
                environment=settings.environment,
                release=settings.app_version,
            )
            logger.info("telemetry.sentry_enabled")

    if settings.otel_exporter_otlp_endpoint:
        instrumentation = _try_import("opentelemetry.instrumentation.fastapi")
        if instrumentation is not None:
            instrumentation.FastAPIInstrumentor.instrument_app(app)
            logger.info("telemetry.otel_enabled")
