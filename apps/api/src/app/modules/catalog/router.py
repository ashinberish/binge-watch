import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, PaginationDep
from app.core.exceptions import problem_responses
from app.modules.catalog.schemas import ShowDetail, ShowRead
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
