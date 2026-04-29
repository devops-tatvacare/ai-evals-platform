"""Scheduler predicates — `skip_criteria` blockers for a scheduled-job fire.

Predicates are flat, OR-composed. Each entry in `skip_criteria` is an
object like `{"type": "eval_running", "scope": "tenant_app"}`. If any
predicate returns `blocked=True` the tick backs off.
"""

from __future__ import annotations

import inspect
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Awaitable, Callable, TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import BackgroundJob

if TYPE_CHECKING:
    from app.models.scheduled_job import ScheduledJobDefinition

_log = logging.getLogger(__name__)


@dataclass(frozen=True)
class PredicateContext:
    tenant_id: Any  # uuid.UUID at runtime; typed Any to avoid import cycles
    app_id: str
    schedule: "ScheduledJobDefinition"
    now: datetime
    db: AsyncSession


@dataclass(frozen=True)
class PredicateResult:
    blocked: bool
    reason: str


@dataclass(frozen=True)
class PredicateRegistration:
    id: str
    label: str
    description: str
    default_scope: str | None = None
    supported_scopes: tuple[str, ...] = field(default_factory=tuple)
    handler: Callable[[PredicateContext, dict], Awaitable[PredicateResult]] | None = None


_REGISTRY: dict[str, PredicateRegistration] = {}


def register_predicate(
    *,
    id: str,  # noqa: A002 — keyword mirrors the public entry's `id`
    label: str,
    description: str,
    default_scope: str | None = None,
    supported_scopes: tuple[str, ...] = (),
) -> Callable[
    [Callable[[PredicateContext, dict], Awaitable[PredicateResult]]],
    Callable[[PredicateContext, dict], Awaitable[PredicateResult]],
]:
    """Decorator: register a predicate handler under `id`.

    Registration is idempotent across re-imports (import-order dependent
    reloads during tests shouldn't blow up), but duplicate IDs within a
    single process lifetime raise.
    """

    def wrap(
        fn: Callable[[PredicateContext, dict], Awaitable[PredicateResult]],
    ) -> Callable[[PredicateContext, dict], Awaitable[PredicateResult]]:
        if id in _REGISTRY and _REGISTRY[id].handler is not fn:
            raise RuntimeError(f"predicate already registered: {id}")
        _REGISTRY[id] = PredicateRegistration(
            id=id,
            label=label,
            description=description,
            default_scope=default_scope,
            supported_scopes=supported_scopes,
            handler=fn,
        )
        return fn

    return wrap


def get_registered_predicates() -> list[dict[str, Any]]:
    """Used by GET /api/scheduled-jobs/registry to populate the UI dropdown."""
    return [
        {
            "id": entry.id,
            "label": entry.label,
            "description": entry.description,
            "defaultScope": entry.default_scope,
            "supportedScopes": list(entry.supported_scopes),
        }
        for entry in sorted(_REGISTRY.values(), key=lambda e: e.id)
    ]


async def evaluate_skip_criteria(
    ctx: PredicateContext,
    skip_criteria: list[dict[str, Any]],
) -> PredicateResult:
    """OR-compose: if ANY predicate blocks, the schedule is blocked.

    Unknown predicate `type` → logged warning + clear (does not block).
    """
    for entry in skip_criteria or []:
        predicate_id = str(entry.get("type") or "").strip()
        if not predicate_id:
            continue
        registration = _REGISTRY.get(predicate_id)
        if registration is None or registration.handler is None:
            _log.warning(
                "scheduler.predicate.unknown",
                extra={"predicateId": predicate_id, "scheduleId": str(ctx.schedule.id)},
            )
            continue
        args = {k: v for k, v in entry.items() if k != "type"}
        handler = registration.handler
        maybe_result = handler(ctx, args)
        if inspect.isawaitable(maybe_result):
            result = await maybe_result
        else:  # pragma: no cover — defensive; registered handlers are async
            result = maybe_result  # type: ignore[assignment]
        if result.blocked:
            return result
    return PredicateResult(blocked=False, reason="clear")


@register_predicate(
    id="eval_running",
    label="An evaluation is running",
    description=(
        "Block a schedule tick while an `evaluate-*` job is running. "
        "Prevents scheduled syncs from contending with a batch evaluation."
    ),
    default_scope="tenant_app",
    supported_scopes=("tenant_app", "tenant", "global"),
)
async def eval_running(ctx: PredicateContext, args: dict) -> PredicateResult:
    scope = str(args.get("scope") or "tenant_app")
    if scope == "global":
        # Explicitly non-implemented per plan §PR2 guardrail; reserve the
        # enum value but do not leak cross-tenant reads to the engine.
        _log.warning(
            "scheduler.predicate.global_scope_not_implemented",
            extra={
                "scheduleId": str(ctx.schedule.id),
                "tenantId": str(ctx.tenant_id),
            },
        )
        return PredicateResult(blocked=False, reason="clear")

    query = select(BackgroundJob.id).where(
        BackgroundJob.status == "running",
        BackgroundJob.job_type.like("evaluate-%"),
    )
    if scope in ("tenant_app", "tenant"):
        query = query.where(BackgroundJob.tenant_id == ctx.tenant_id)
    if scope == "tenant_app":
        query = query.where(BackgroundJob.app_id == ctx.app_id)

    running = (await ctx.db.execute(query.limit(1))).scalar_one_or_none()
    if running:
        return PredicateResult(blocked=True, reason=f"eval_running:{running}")
    return PredicateResult(blocked=False, reason="clear")
