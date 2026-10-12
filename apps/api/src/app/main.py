"""ASGI entrypoint: ``uvicorn app.main:app``."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.openapi import build_openapi
from app.api.v1.router import router as v1_router
from app.core.config import Settings, get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.security import configure_password_hasher
from app.core.telemetry import setup_telemetry
from app.db.session import create_engine, create_sessionmaker
from app.middleware.request_id import REQUEST_ID_HEADER, RequestIDMiddleware

logger = get_logger(__name__)

OPENAPI_TAGS = [
    {"name": "health", "description": "Liveness and readiness probes."},
    {"name": "auth", "description": "Registration, login and token rotation."},
    {"name": "users", "description": "The authenticated account."},
    {"name": "profiles", "description": "Viewer profiles under an account."},
    {"name": "catalog", "description": "Shows, seasons and episodes."},
    {"name": "watch_history", "description": "Playback progress and continue-watching."},
    {"name": "streaks", "description": "Binge streaks."},
]


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings)
    configure_password_hasher(
        time_cost=settings.argon2_time_cost,
        memory_cost=settings.argon2_memory_cost,
        parallelism=settings.argon2_parallelism,
    )

    engine = create_engine(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        logger.info("app.startup", environment=settings.environment)
        yield
        await engine.dispose()
        logger.info("app.shutdown")

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Nightreel: binge-watching companion API.",
        debug=settings.debug,
        lifespan=lifespan,
        openapi_tags=OPENAPI_TAGS,
        separate_input_output_schemas=False,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = create_sessionmaker(engine)

    # Order: last added = outermost. Request ID wraps everything (including CORS).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER],
    )
    app.add_middleware(RequestIDMiddleware)

    register_exception_handlers(app)

    app.include_router(health_router)
    app.include_router(v1_router, prefix="/api/v1")

    app.openapi = lambda: build_openapi(app)  # type: ignore[method-assign]

    setup_telemetry(app, settings)
    return app


app = create_app()
