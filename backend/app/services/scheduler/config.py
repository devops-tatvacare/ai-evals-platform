"""Scheduler engine defaults and shared constants."""

from typing import Final

DEFAULT_RETRY_COUNT: Final[int] = 0
DEFAULT_RETRY_INTERVAL_MINUTES: Final[int] = 15
DEFAULT_ON_EXHAUST: Final[str] = "wait_next_tick"

VALID_ON_EXHAUST_MODES: Final[frozenset[str]] = frozenset({"wait_next_tick"})

DEFAULT_TICK_INTERVAL_SECONDS: Final[int] = 60
SCHEDULER_TICK_ADVISORY_LOCK_KEY: Final[int] = 8722
