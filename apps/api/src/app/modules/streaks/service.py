"""Binge streak rules.

A *streak day* is a UTC calendar day on which the profile completed at least one
episode. Completing an episode on the day after the last active day extends the
streak; skipping a day resets it to 1. A streak is still "current" on the day after
the last active day (the viewer has until the end of today to keep it alive).
"""

import uuid
from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import Depends

from app.core.time import utcnow
from app.modules.profiles.service import ProfileService, ProfileServiceDep
from app.modules.streaks.models import Streak
from app.modules.streaks.repository import StreakRepository, StreakRepositoryDep
from app.modules.streaks.schemas import StreakRead


def apply_completion(streak: Streak, day: date) -> None:
    """Mutate ``streak`` for one completed episode on ``day``."""
    last = streak.last_active_date
    if last == day:
        streak.episodes_today += 1
    elif last is not None and last > day:
        # Late/out-of-order event for a past day: it can't extend the visible streak.
        return
    else:
        streak.current_days = streak.current_days + 1 if last == day - timedelta(days=1) else 1
        streak.episodes_today = 1
        streak.last_active_date = day
    streak.longest_days = max(streak.longest_days, streak.current_days)


def view_streak(streak: Streak | None, today: date) -> StreakRead:
    """Project a stored streak onto ``today`` (decaying stale counters)."""
    if streak is None or streak.last_active_date is None:
        return StreakRead(current_days=0, longest_days=0, episodes_today=0)
    last = streak.last_active_date
    alive = last >= today - timedelta(days=1)
    return StreakRead(
        current_days=streak.current_days if alive else 0,
        longest_days=streak.longest_days,
        episodes_today=streak.episodes_today if last == today else 0,
    )


class StreakService:
    def __init__(self, streaks: StreakRepository, profiles: ProfileService) -> None:
        self.streaks = streaks
        self.profiles = profiles

    async def get_current(
        self, user_id: uuid.UUID, profile_id: uuid.UUID, *, now: datetime | None = None
    ) -> StreakRead:
        await self.profiles.get_owned(user_id, profile_id)
        streak = await self.streaks.get_by_profile(profile_id)
        return view_streak(streak, (now or utcnow()).date())

    async def record_completion(self, profile_id: uuid.UUID, at: datetime) -> Streak:
        """Register a completed episode. Does not commit: the caller owns the transaction."""
        streak = await self.streaks.get_by_profile(profile_id)
        if streak is None:
            streak = Streak(profile_id=profile_id, current_days=0, longest_days=0, episodes_today=0)
            self.streaks.add(streak)
            await self.streaks.flush()
        apply_completion(streak, at.date())
        return streak


def get_streak_service(streaks: StreakRepositoryDep, profiles: ProfileServiceDep) -> StreakService:
    return StreakService(streaks, profiles)


StreakServiceDep = Annotated[StreakService, Depends(get_streak_service)]
