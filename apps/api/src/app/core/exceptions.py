"""Application error hierarchy rendered as RFC 9457 ``application/problem+json``."""

from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, ClassVar

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger

PROBLEM_JSON = "application/problem+json"
PROBLEM_BASE_URI = "https://nightreel.app/problems/"

logger = get_logger(__name__)


class ProblemDetail(BaseModel):
    """RFC 9457 problem details object."""

    type: str = Field(default="about:blank", description="URI identifying the problem type.")
    title: str = Field(description="Short, human-readable summary of the problem type.")
    status: int = Field(description="HTTP status code.")
    detail: str | None = Field(default=None, description="Explanation of this occurrence.")
    instance: str | None = Field(default=None, description="URI of the failing request.")


class ValidationErrorItem(BaseModel):
    loc: list[str | int]
    msg: str
    type: str


class ValidationProblemDetail(ProblemDetail):
    errors: list[ValidationErrorItem] = Field(default_factory=list)


class AppError(Exception):
    """Base class for expected, client-facing errors."""

    status_code: ClassVar[int] = 500
    title: ClassVar[str] = "Internal Server Error"
    slug: ClassVar[str | None] = None

    def __init__(self, detail: str | None = None, *, headers: dict[str, str] | None = None):
        super().__init__(detail or self.title)
        self.detail = detail
        self.headers = headers

    @property
    def type_uri(self) -> str:
        return f"{PROBLEM_BASE_URI}{self.slug}" if self.slug else "about:blank"


class BadRequestError(AppError):
    status_code = 400
    title = "Bad Request"
    slug = "bad-request"


class UnauthorizedError(AppError):
    status_code = 401
    title = "Unauthorized"
    slug = "unauthorized"

    def __init__(self, detail: str | None = None) -> None:
        super().__init__(detail, headers={"WWW-Authenticate": "Bearer"})


class ForbiddenError(AppError):
    status_code = 403
    title = "Forbidden"
    slug = "forbidden"


class NotFoundError(AppError):
    status_code = 404
    title = "Not Found"
    slug = "not-found"


class ConflictError(AppError):
    status_code = 409
    title = "Conflict"
    slug = "conflict"


class ServiceUnavailableError(AppError):
    status_code = 503
    title = "Service Unavailable"
    slug = "service-unavailable"


def problem_response(
    *,
    status: int,
    title: str,
    detail: str | None,
    request: Request,
    type_uri: str = "about:blank",
    headers: Mapping[str, str] | None = None,
    extra: dict[str, Any] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = ProblemDetail(
        type=type_uri, title=title, status=status, detail=detail, instance=request.url.path
    ).model_dump()
    if extra:
        body.update(extra)
    return JSONResponse(body, status_code=status, headers=headers, media_type=PROBLEM_JSON)


async def _app_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)  # noqa: S101 - narrowing for the type checker
    return problem_response(
        status=exc.status_code,
        title=exc.title,
        detail=exc.detail,
        type_uri=exc.type_uri,
        headers=exc.headers,
        request=request,
    )


async def _http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)  # noqa: S101
    status = exc.status_code
    try:
        title = HTTPStatus(status).phrase
    except ValueError:
        title = "Error"
    detail = exc.detail if isinstance(exc.detail, str) and exc.detail != title else None
    return problem_response(
        status=status, title=title, detail=detail, headers=exc.headers, request=request
    )


async def _validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)  # noqa: S101
    errors = [
        ValidationErrorItem(
            loc=[part if isinstance(part, int) else str(part) for part in err.get("loc", ())],
            msg=str(err.get("msg", "")),
            type=str(err.get("type", "")),
        ).model_dump()
        for err in exc.errors()
    ]
    return problem_response(
        status=422,
        title="Unprocessable Content",
        detail="Request validation failed.",
        type_uri=f"{PROBLEM_BASE_URI}validation-error",
        request=request,
        extra={"errors": errors},
    )


async def _unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled_error", path=request.url.path, error=type(exc).__name__)
    return problem_response(
        status=500,
        title="Internal Server Error",
        detail="An unexpected error occurred.",
        request=request,
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
    app.add_exception_handler(Exception, _unhandled_error_handler)


_DESCRIPTIONS: dict[int, str] = {
    400: "Bad request",
    401: "Missing or invalid credentials",
    403: "Forbidden",
    404: "Resource not found",
    409: "Conflict with the current state of the resource",
    422: "Request validation failed",
    503: "Service unavailable",
}


def problem_responses(*codes: int) -> dict[int | str, dict[str, Any]]:
    """OpenAPI ``responses`` entries documenting problem+json error bodies."""
    return {
        code: {
            "model": ValidationProblemDetail if code == 422 else ProblemDetail,
            "description": _DESCRIPTIONS.get(code, HTTPStatus(code).phrase),
        }
        for code in codes
    }
