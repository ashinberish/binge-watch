import json
import uuid
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.telemetry import setup_telemetry
from app.main import create_app
from app.modules.billing.entitlements import require_feature
from app.modules.users.models import User
from app.scripts import export_openapi

EXPECTED_OPERATION_IDS = {
    "health_live",
    "health_ready",
    "auth_register",
    "auth_login",
    "auth_refresh",
    "auth_logout",
    "auth_create_extension_code",
    "auth_exchange_extension_code",
    "users_get_me",
    "users_update_me",
    "profiles_list",
    "profiles_create",
    "profiles_update",
    "profiles_delete",
    "catalog_list_shows",
    "catalog_get_show",
    "catalog_match",
    "catalog_get_next_episode",
    "history_update_progress",
    "history_continue_watching",
    "streaks_get_current",
    "parties_create",
    "parties_get",
    "parties_join",
    "parties_leave",
}


async def test_require_feature_always_allows() -> None:
    check = require_feature("advanced_insights")
    assert check.__name__ == "require_feature_advanced_insights"
    user = User(id=uuid.uuid4(), email="x@example.com", password_hash="h", display_name="X")
    await check(user)  # does not raise


def test_export_openapi(tmp_path: Path) -> None:
    out = tmp_path / "nested" / "openapi.json"
    assert export_openapi.main([str(out)]) == 0
    schema = json.loads(out.read_text())

    op_ids = {op["operationId"] for path in schema["paths"].values() for op in path.values()}
    assert op_ids == EXPECTED_OPERATION_IDS
    assert "HTTPValidationError" not in schema["components"]["schemas"]

    register = schema["paths"]["/api/v1/auth/register"]["post"]
    assert "201" in register["responses"]
    assert "application/problem+json" in register["responses"]["409"]["content"]
    assert "application/problem+json" in register["responses"]["422"]["content"]


def test_export_openapi_usage() -> None:
    assert export_openapi.main([]) == 2


def test_telemetry_is_noop_without_sdks(settings: Settings) -> None:
    configured = settings.model_copy(
        update={"sentry_dsn": "https://k@sentry.invalid/1", "otel_exporter_otlp_endpoint": "x"}
    )
    app = create_app(settings)
    setup_telemetry(app, configured)  # SDKs not installed -> logs a warning, does not raise


@pytest.mark.parametrize("level", ["DEBUG", "bogus"])
def test_create_app_with_console_logging(settings: Settings, level: str) -> None:
    app = create_app(settings.model_copy(update={"log_json": True, "log_level": level}))
    assert app.title == "Nightreel API"
