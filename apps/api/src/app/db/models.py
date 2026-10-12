"""Import every ORM model so ``Base.metadata`` is complete (Alembic, tests, seeding)."""

from app.db.base import Base
from app.modules.auth.models import ExtensionCode, RefreshToken
from app.modules.catalog.models import Episode, EpisodeExternalId, Season, Show
from app.modules.profiles.models import Profile
from app.modules.streaks.models import Streak
from app.modules.users.models import User
from app.modules.watch_history.models import WatchProgress

__all__ = [
    "Base",
    "Episode",
    "EpisodeExternalId",
    "ExtensionCode",
    "Profile",
    "RefreshToken",
    "Season",
    "Show",
    "Streak",
    "User",
    "WatchProgress",
]
