from fastapi import APIRouter, status

from app.api.deps import CurrentUser
from app.core.exceptions import problem_responses
from app.modules.auth.schemas import (
    ExtensionCode,
    ExtensionCodeRequest,
    ExtensionTokenRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
)
from app.modules.auth.service import AuthServiceDep
from app.modules.users.schemas import UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    operation_id="auth_register",
    responses=problem_responses(409, 422),
)
async def register(data: RegisterRequest, service: AuthServiceDep) -> UserRead:
    """Create a new account."""
    return UserRead.model_validate(await service.register(data))


@router.post(
    "/login",
    response_model=TokenPair,
    operation_id="auth_login",
    responses=problem_responses(401, 422),
)
async def login(data: LoginRequest, service: AuthServiceDep) -> TokenPair:
    """Exchange email and password for an access/refresh token pair."""
    return await service.login(data)


@router.post(
    "/refresh",
    response_model=TokenPair,
    operation_id="auth_refresh",
    responses=problem_responses(401, 422),
)
async def refresh(data: RefreshRequest, service: AuthServiceDep) -> TokenPair:
    """Rotate a refresh token: the presented token is revoked and a new pair issued."""
    return await service.refresh(data.refresh_token)


@router.post(
    "/logout",
    response_model=None,
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="auth_logout",
    responses=problem_responses(422),
)
async def logout(data: RefreshRequest, service: AuthServiceDep) -> None:
    """Revoke a refresh token."""
    await service.logout(data.refresh_token)


@router.post(
    "/extension-code",
    response_model=ExtensionCode,
    status_code=status.HTTP_201_CREATED,
    operation_id="auth_create_extension_code",
    responses=problem_responses(401, 422),
)
async def create_extension_code(
    data: ExtensionCodeRequest, user: CurrentUser, service: AuthServiceDep
) -> ExtensionCode:
    """Issue a one-time code for the Chrome extension sign-in handoff.

    The signed-in web app calls this, then redirects to `redirect_uri` with the code; the
    extension redeems it at `POST /auth/extension-token`. Codes expire after 60 seconds.
    """
    return await service.create_extension_code(user.id, data.redirect_uri)


@router.post(
    "/extension-token",
    response_model=TokenPair,
    operation_id="auth_exchange_extension_code",
    responses=problem_responses(401, 422),
)
async def exchange_extension_code(
    data: ExtensionTokenRequest, service: AuthServiceDep
) -> TokenPair:
    """Redeem a one-time extension code (single use, bound to its redirect URI) for tokens."""
    return await service.exchange_extension_code(data)
