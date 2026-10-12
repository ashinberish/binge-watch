import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, PaginationDep
from app.core.exceptions import problem_responses
from app.modules.catalog.schemas import (
    MatchRequest,
    MatchResult,
    NextEpisode,
    ShowDetail,
    ShowRead,
)
from app.modules.catalog.service import CatalogServiceDep

router = APIRouter(prefix="/catalog", tags=["catalog"], responses=problem_responses(401))


@router.get(
    "/shows",
    response_model=list[ShowRead],
    operation_id="catalog_list_shows",
    responses=problem_responses(422),
)
async def list_shows(
    _user: CurrentUser,
    service: CatalogServiceDep,
    pagination: PaginationDep,
    q: Annotated[str | None, Query(max_length=100, description="Title search.")] = None,
) -> list[ShowRead]:
    """Browse or search the show catalog."""
    shows = await service.search_shows(q, limit=pagination.limit, offset=pagination.offset)
    return [ShowRead.model_validate(show) for show in shows]


@router.get(
    "/shows/{show_id}",
    response_model=ShowDetail,
    operation_id="catalog_get_show",
    responses=problem_responses(404, 422),
)
async def get_show(
    show_id: uuid.UUID, _user: CurrentUser, service: CatalogServiceDep
) -> ShowDetail:
    """Show detail including seasons and episodes."""
    return ShowDetail.model_validate(await service.get_show(show_id))


@router.post(
    "/match",
    response_model=MatchResult,
    operation_id="catalog_match",
    responses=problem_responses(422),
)
async def match_episode(
    data: MatchRequest, _user: CurrentUser, service: CatalogServiceDep
) -> MatchResult:
    """Resolve what is playing on a streaming site to a catalog episode.

    Lookup order: a previous match for `(provider, external_id)`; then the show by
    case-insensitive exact title plus season/episode numbers. Anything still missing
    (show, season, episode) is created on first sight, so every supported player works
    before metadata enrichment. Always returns 200 with the matched episode.
    """
    return await service.match(data)


@router.get(
    "/episodes/{episode_id}/next",
    response_model=NextEpisode,
    operation_id="catalog_get_next_episode",
    responses=problem_responses(404, 422),
)
async def get_next_episode(
    episode_id: uuid.UUID, _user: CurrentUser, service: CatalogServiceDep
) -> NextEpisode:
    """The episode after this one: next in the season, else the first of the next season.

    404 if the episode doesn't exist or is the last one of its show.
    """
    return await service.get_next_episode(episode_id)
