from datetime import date, timedelta

from app.modules.streaks.models import Streak
from app.modules.streaks.service import apply_completion, view_streak
from app.modules.watch_history.service import is_completed

DAY = date(2026, 1, 10)


def new_streak() -> Streak:
    return Streak(current_days=0, longest_days=0, episodes_today=0, last_active_date=None)


def test_first_completion_starts_streak() -> None:
    s = new_streak()
    apply_completion(s, DAY)
    assert (s.current_days, s.longest_days, s.episodes_today) == (1, 1, 1)
    assert s.last_active_date == DAY


def test_same_day_increments_episodes_only() -> None:
    s = new_streak()
    apply_completion(s, DAY)
    apply_completion(s, DAY)
    assert (s.current_days, s.episodes_today) == (1, 2)


def test_consecutive_days_extend_streak() -> None:
    s = new_streak()
    for offset in range(3):
        apply_completion(s, DAY + timedelta(days=offset))
    assert (s.current_days, s.longest_days, s.episodes_today) == (3, 3, 1)


def test_gap_resets_but_keeps_longest() -> None:
    s = new_streak()
    apply_completion(s, DAY)
    apply_completion(s, DAY + timedelta(days=1))
    apply_completion(s, DAY + timedelta(days=5))
    assert (s.current_days, s.longest_days) == (1, 2)


def test_out_of_order_event_is_ignored() -> None:
    s = new_streak()
    apply_completion(s, DAY)
    apply_completion(s, DAY - timedelta(days=3))
    assert (s.current_days, s.episodes_today, s.last_active_date) == (1, 1, DAY)


def test_view_streak_decay() -> None:
    assert view_streak(None, DAY).current_days == 0
    s = new_streak()
    assert view_streak(s, DAY).longest_days == 0
    apply_completion(s, DAY)
    apply_completion(s, DAY)

    today = view_streak(s, DAY)
    assert (today.current_days, today.episodes_today) == (1, 2)

    tomorrow = view_streak(s, DAY + timedelta(days=1))
    assert (tomorrow.current_days, tomorrow.episodes_today) == (1, 0)

    later = view_streak(s, DAY + timedelta(days=2))
    assert (later.current_days, later.longest_days, later.episodes_today) == (0, 1, 0)


def test_completion_threshold() -> None:
    assert not is_completed(899, 1000)
    assert is_completed(900, 1000)
    assert is_completed(1000, 1000)
    assert not is_completed(8, 10)
    assert is_completed(9, 10)
