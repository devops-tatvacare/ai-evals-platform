"""Shared logging configuration for backend + worker.

Called once at process startup from both entrypoints:
  - app.main lifespan  (FastAPI/uvicorn backend; also hosts the embedded worker
                        when JOB_RUN_EMBEDDED_WORKER=true)
  - app.worker         (dedicated worker process; JOB_RUN_EMBEDDED_WORKER=false)

Idempotent: safe to call more than once.

Level + format come from Settings (LOG_LEVEL, LOG_FORMAT), env-overridable.
Does not touch uvicorn's own loggers (uvicorn, uvicorn.access, uvicorn.error);
those are configured by uvicorn itself and we leave them alone.
"""
import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

from app.config import settings


# Standard LogRecord attributes we should not re-emit as payload fields
# (copied out of the json output to keep messages tidy).
_RESERVED_LOG_RECORD_ATTRS = frozenset(
    {
        "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
        "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
        "created", "msecs", "relativeCreated", "thread", "threadName",
        "processName", "process", "message", "taskName",
    }
)


class JsonFormatter(logging.Formatter):
    """Render each LogRecord as one JSON line.

    Any `extra={...}` fields attached at the call site (e.g.
    ``logger.info("claimed", extra={"job_id": ...})``) land as top-level
    keys. This makes the logs queryable in Log Analytics / KQL without
    regex parsing.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)

        # Surface extras (job_id, tenant_id, etc.) if the caller attached them.
        for key, value in record.__dict__.items():
            if key in _RESERVED_LOG_RECORD_ATTRS or key.startswith("_"):
                continue
            # Let json handle primitives; fall back to str for odd objects.
            try:
                json.dumps(value)
                payload[key] = value
            except (TypeError, ValueError):
                payload[key] = str(value)

        return json.dumps(payload, ensure_ascii=False)


_CONSOLE_FORMAT = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"


def configure_logging() -> None:
    """Attach a single StreamHandler(stdout) to the root logger.

    Idempotent — a second call replaces existing handlers so repeated
    calls during test setup or hot-reload don't duplicate output.
    """
    root = logging.getLogger()

    # Remove any pre-existing handlers we placed on previous calls. Leave
    # handlers attached by other libraries (uvicorn, pytest) alone by
    # checking the sentinel we set below.
    for existing in list(root.handlers):
        if getattr(existing, "_evals_managed", False):
            root.removeHandler(existing)

    handler = logging.StreamHandler(sys.stdout)
    handler._evals_managed = True  # type: ignore[attr-defined]

    log_format = (settings.LOG_FORMAT or "json").strip().lower()
    if log_format == "console":
        handler.setFormatter(logging.Formatter(_CONSOLE_FORMAT))
    else:
        handler.setFormatter(JsonFormatter())

    level_name = (settings.LOG_LEVEL or "INFO").strip().upper()
    level = getattr(logging, level_name, logging.INFO)

    root.addHandler(handler)
    root.setLevel(level)

    for logger_name in ('httpx', 'httpcore'):
        library_logger = logging.getLogger(logger_name)
        library_logger.setLevel(max(level, logging.WARNING))

    # Uvicorn configures its own loggers; we intentionally do not touch
    # uvicorn / uvicorn.access / uvicorn.error here. Our application
    # loggers ("app.*") propagate up to the root handler we just added.
