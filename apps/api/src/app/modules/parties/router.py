from fastapi import APIRouter, WebSocket, status

from app.api.deps import CurrentUser
from app.core.exceptions import problem_responses
from app.modules.parties.hub import PartyHubDep
from app.modules.parties.realtime import PartyConnection
from app.modules.parties.schemas import PartyCreate, PartyRead
from app.modules.parties.service import PartyServiceDep

router = APIRouter(prefix="/parties", tags=["parties"], responses=problem_responses(401))


@router.post(
    "",
    response_model=PartyRead,
    status_code=status.HTTP_201_CREATED,
    operation_id="parties_create",
    responses=problem_responses(422),
)
async def create_party(data: PartyCreate, user: CurrentUser, service: PartyServiceDep) -> PartyRead:
    """Start a watch party for a video. The caller hosts it and is its first member.

    Share `invite_url`; friends open it, sign in and call `POST /parties/{code}/join`.
    Parties expire after `APP_PARTY_TTL_HOURS` (default 12).
    """
    return await service.create(user, data)


@router.get(
    "/{code}",
    response_model=PartyRead,
    operation_id="parties_get",
    responses=problem_responses(404, 422),
)
async def get_party(code: str, _user: CurrentUser, service: PartyServiceDep) -> PartyRead:
    """Look up a party by invite code (any signed-in user who has the code).

    404 if the code is unknown or the party has ended or expired.
    """
    return await service.get(code)


@router.post(
    "/{code}/join",
    response_model=PartyRead,
    operation_id="parties_join",
    responses=problem_responses(404, 409, 422),
)
async def join_party(code: str, user: CurrentUser, service: PartyServiceDep) -> PartyRead:
    """Join a party (idempotent). Required before opening the party WebSocket.

    404 if unknown, ended or expired; 409 when the party is full.
    """
    return await service.join(user, code)


@router.post(
    "/{code}/leave",
    response_model=None,
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="parties_leave",
    responses=problem_responses(404, 422),
)
async def leave_party(code: str, user: CurrentUser, service: PartyServiceDep) -> None:
    """Leave a party (idempotent). When the last member leaves, the party ends and open
    WebSockets receive `{"type": "ended"}`."""
    await service.leave(user, code)


@router.websocket("/{code}/ws")
async def party_socket(websocket: WebSocket, code: str, hub: PartyHubDep) -> None:
    """Synced playback channel. Not in OpenAPI; see README "Watch parties" for the protocol."""
    app_state = websocket.app.state
    connection = PartyConnection(
        websocket,
        code,
        hub=hub,
        settings=app_state.settings,
        sessionmaker=app_state.sessionmaker,
    )
    await connection.serve()
