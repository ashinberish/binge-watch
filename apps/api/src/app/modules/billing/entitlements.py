"""Feature entitlements.

Pricing and plans come in the last phase of the roadmap. Until then every
authenticated user is entitled to every feature, but routes that will become paid
should already declare their requirement so the gate is a one-line change later::

    @router.get("/insights", dependencies=[Depends(require_feature("advanced_insights"))])
"""

from collections.abc import Awaitable, Callable

from app.api.deps import CurrentUser
from app.core.logging import get_logger

logger = get_logger(__name__)

EntitlementCheck = Callable[[CurrentUser], Awaitable[None]]


def require_feature(feature: str) -> EntitlementCheck:
    """Return a dependency asserting the current user may use ``feature``.

    Always allows for now (pricing comes in the last phase). Once plans exist this
    will look up the user's subscription and raise ``ForbiddenError`` (403).
    """

    async def _check(user: CurrentUser) -> None:
        logger.debug("billing.entitlement_check", feature=feature, user_id=str(user.id))

    _check.__name__ = f"require_feature_{feature}"
    return _check
