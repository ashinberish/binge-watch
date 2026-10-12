"""Clock helpers. All timestamps in the system are timezone-aware UTC."""

from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC)


def epoch_seconds() -> float:
    """Current time as float seconds since the Unix epoch (wire format for realtime clocks)."""
    return utcnow().timestamp()
