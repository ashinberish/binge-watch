from fastapi import APIRouter, status

from app.core.exceptions import problem_responses
from app.modules.auth.schemas import LoginRequest, RefreshRequest, RegisterRequest, TokenPair
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
