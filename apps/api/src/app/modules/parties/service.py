import secrets
import uuid
from datetime import timedelta
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Depends
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings, SettingsDep
from app.core.exceptions import ConflictError, NotFoundError
from app.core.logging import get_logger
from app.core.time import utcnow
from app.modules.catalog.repository import CatalogRepository, CatalogRepositoryDep
from app.modules.parties.hub import PartyHub, PartyHubDep
from app.modules.parties.models import Party, PartyMember
from app.modules.parties.repository import PartyRepository, PartyRepositoryDep
from app.modules.parties.schemas import PartyCreate, PartyRead, PartyUser
from app.modules.users.models import User

logger = get_logger(__name__)

# No 0/o, 1/l/i: codes are read aloud and retyped.
CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
CODE_LENGTH = 10
CODE_ATTEMPTS = 5
MAX_CODE_INPUT_LENGTH = 32


def generate_party_code(length: int = CODE_LENGTH) -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(length))


def normalize_code(code: str) -> str:
    return code.strip().lower()


def _body_error(field: str, message: str) -> RequestValidationError:
    """A 422 shaped exactly like FastAPI's own body validation errors."""
    return RequestValidationError([{"loc": ("body", field), "msg": message, "type": "value_error"}])


class PartyService:
    def __init__(
        self,
        parties: PartyRepository,
        catalog: CatalogRepository,
        hub: PartyHub,
        settings: Settings,
    ) -> None:
        self.parties = parties
        self.catalog = catalog
        self.hub = hub
        self.settings = settings

    def invite_url(self, code: str) -> str:
        return f"{self.settings.web_url.rstrip('/')}/party/{code}"

    def is_allowed_watch_url(self, watch_url: str) -> bool:
        host = (urlsplit(watch_url).hostname or "").lower()
        allowed = {h.strip().lower() for h in self.settings.party_allowed_hosts}
        return host in allowed

    async def create(self, user: User, data: PartyCreate) -> PartyRead:
        if not self.is_allowed_watch_url(data.watch_url):
            raise _body_error("watch_url", "Value error, this site is not supported for parties")
        if data.episode_id is not None and await self.catalog.get_episode(data.episode_id) is None:
            raise _body_error("episode_id", "Value error, unknown episode")

        for attempt in range(CODE_ATTEMPTS):
            code = generate_party_code()
            if await self.parties.code_exists(code):
                continue
            party = Party(
                code=code,
                host_user_id=user.id,
                provider=data.provider,
                watch_url=data.watch_url,
                episode_id=data.episode_id,
                expires_at=utcnow() + timedelta(seconds=self.settings.party_ttl_seconds),
            )
            self.parties.add(party)
            try:
                await self.parties.flush()
                self.parties.add(PartyMember(party_id=party.id, user_id=user.id))
                await self.parties.commit()
            except IntegrityError:  # a concurrent create took the same code
                await self.parties.rollback()
                logger.info("parties.code_collision", attempt=attempt)
                continue
            logger.info("parties.created", party_id=str(party.id), user_id=str(user.id))
            return await self._read(party.id)
        raise ConflictError("Could not allocate a party code, please retry.")  # pragma: no cover

    async def get(self, code: str) -> PartyRead:
        party = await self.get_active(code)
        return await self._to_read(party)

    async def join(self, user: User, code: str) -> PartyRead:
        party = await self.get_active(code, for_update=True)
        if await self.parties.get_member(party.id, user.id) is None:
            if await self.parties.count_members(party.id) >= self.settings.party_max_members:
                raise ConflictError("This party is full.")
            self.parties.add(PartyMember(party_id=party.id, user_id=user.id))
            try:
                await self.parties.commit()
            except IntegrityError:  # the same user joined concurrently: already a member
                await self.parties.rollback()
            else:
                logger.info("parties.joined", party_id=str(party.id), user_id=str(user.id))
        return await self._read(party.id)

    async def leave(self, user: User, code: str) -> None:
        """Leave a party (idempotent). The party ends once nobody is left in it."""
        party = await self.get_active(code)
        member = await self.parties.get_member(party.id, user.id)
        if member is None:
            return
        await self.parties.delete(member)
        await self.parties.flush()
        ended = await self.parties.count_members(party.id) == 0
        if ended:
            party.ended_at = utcnow()
        await self.parties.commit()
        logger.info("parties.left", party_id=str(party.id), user_id=str(user.id), ended=ended)
        if ended:
            await self.hub.end(party.code)

    async def get_active(self, code: str, *, for_update: bool = False) -> Party:
        """The party for an invite code; 404 if unknown, ended or expired."""
        normalized = normalize_code(code)
        party = None
        if 0 < len(normalized) <= MAX_CODE_INPUT_LENGTH:
            party = await self.parties.get_by_code(normalized, for_update=for_update)
        if party is None or not party.is_active(utcnow()):
            raise NotFoundError("Party not found or no longer active.")
        return party

    async def is_member(self, party: Party, user_id: uuid.UUID) -> bool:
        return await self.parties.get_member(party.id, user_id) is not None

    async def end_expired(self) -> list[str]:
        """Mark expired parties ended and tell connected viewers. Returns their codes."""
        expired = await self.parties.list_expired_open(utcnow())
        if not expired:
            return []
        await self.parties.mark_ended([p.id for p in expired], utcnow())
        await self.parties.commit()
        codes = [p.code for p in expired]
        for code in codes:
            await self.hub.end(code)
        logger.info("parties.expired_ended", count=len(codes))
        return codes

    async def _read(self, party_id: uuid.UUID) -> PartyRead:
        party = await self.parties.get(party_id)
        if party is None:  # pragma: no cover - deleted between write and read
            raise NotFoundError("Party not found or no longer active.")
        return await self._to_read(party)

    async def _to_read(self, party: Party) -> PartyRead:
        return PartyRead(
            id=party.id,
            code=party.code,
            invite_url=self.invite_url(party.code),
            provider=party.provider,
            watch_url=party.watch_url,
            episode_id=party.episode_id,
            host=PartyUser.model_validate(party.host),
            member_count=await self.parties.count_members(party.id),
            expires_at=party.expires_at,
            created_at=party.created_at,
        )


def get_party_service(
    parties: PartyRepositoryDep,
    catalog: CatalogRepositoryDep,
    hub: PartyHubDep,
    settings: SettingsDep,
) -> PartyService:
    return PartyService(parties, catalog, hub, settings)


PartyServiceDep = Annotated[PartyService, Depends(get_party_service)]
