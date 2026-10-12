from pydantic import BaseModel, Field


class StreakRead(BaseModel):
    current_days: int = Field(description="Consecutive UTC days (ending today or yesterday).")
    longest_days: int
    episodes_today: int = Field(description="Episodes completed today (UTC).")
