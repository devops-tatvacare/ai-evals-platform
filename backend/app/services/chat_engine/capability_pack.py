"""Phase 3 — canonical CapabilityPack Protocol + registry.

Plan §6.3: every Sherlock capability pack MUST satisfy the Protocol in
this module. The ``CAPABILITY_PACK_REGISTRY`` dict is the single place
Harness Core plugs a new pack in. ``App.config.chat.capabilities`` values
are pack ids.

Binding rules (§6.3):

1. Harness Core imports packs by id, not by module path.
2. ``tool_definitions.CAPABILITY_TOOLS`` collapses into pack ``tool_specs()``.
3. Every pack owns its own ``describe_tools()``. No pack may read another
   pack's manifest or semantic model.
4. Reason codes are pack-scoped. ``pack_id + reason_code`` is the primary
   key. Only codes in ``HARNESS_SHARED_REASON_CODES`` may repeat.
5. Artifact contracts are pack-scoped. ``ChartPayload`` is
   ``artifact_contracts["analytics.chart.v1"]`` in the analytics pack, not
   a harness global. Harness Core carries artifacts as opaque
   ``(pack_id, contract_id, payload, extras)`` tuples.
"""

from __future__ import annotations

import importlib
import logging
import uuid
from functools import cache
from pathlib import Path
from typing import Any, Mapping, Protocol, Sequence, runtime_checkable

from app.services.chat_engine.artifact import (
    Outcome,
    ToolEnvelopeModel,
    build_envelope,
    error_envelope,
)

_log = logging.getLogger(__name__)


class TypedArgumentError(ValueError):
    """Raised by a pack's ``validate_arguments`` with a typed ``reason_code``.

    Prose errors are forbidden at the tool boundary (§6.3 Protocol).
    The ``reason_code`` MUST live in the owning pack's registered
    frozenset in ``reason_codes.py``.
    """

    def __init__(self, reason_code: str, message: str = '') -> None:
        super().__init__(message or reason_code)
        self.reason_code = reason_code


@runtime_checkable
class CapabilityPack(Protocol):
    """Binding contract every Sherlock capability pack must satisfy."""

    pack_id: str
    reason_codes: frozenset[str]
    artifact_contracts: Mapping[str, type]
    artifact_extras_contracts: Mapping[str, type]

    def tool_specs(self) -> Sequence[Mapping[str, Any]]:
        """Tool definitions contributed to the harness resolve_tools() output.

        Each spec MUST carry inputSchema AND outputSchema (Phase 3 strict).
        """
        ...

    def tool_handlers(self) -> Mapping[str, Any]:
        """Tool-name -> async handler returning the §6.2 envelope."""
        ...

    def validate_arguments(self, tool_name: str, args: Mapping[str, Any]) -> None:
        """Raise ``TypedArgumentError`` with ``reason_code`` on invalid args.

        Runs at the tool boundary; prose errors forbidden.
        """
        ...

    def describe_tools(self, app_id: str) -> Mapping[str, str]:
        """Generated tool descriptions for this pack, substituted from
        pack-local vocabulary (manifest, vector index metadata, graph
        schema, ...). Harness Core MUST NOT hand-edit these strings.
        """
        ...

    def build_outcome(self, tool_name: str, raw_result: Any) -> Outcome:
        """Convert a handler's raw envelope into an ``Outcome``.

        Packs own the mapping from their native result shape into
        kind / reason_code / counts / artifact (including artifact.extras,
        validated against ``artifact_extras_contracts`` at egress).
        """
        ...

    def describe_job(self, job: Any) -> str:
        """Phase 7: render one line describing a platform job the pack owns.

        The chat handler's ``assemble_context`` calls this for every job in
        this session's pending-jobs block. Packs MAY override to include
        domain-specific detail (query name, artifact path, ...); the default
        implementation in ``render_job_line`` is fine for packs that submit
        generic work.
        """
        ...

    # ---- Phase 1 / M1 (scoped-bundle rewrite): optional projection hook ----
    #
    # Packs MAY implement ``contribute_projection(scope)`` returning a
    # :class:`app.services.sherlock.bundle_types.PackProjection`. The
    # bundle layer looks it up via ``getattr`` (see
    # :func:`collect_pack_projections`) so packs that do not opt in stay
    # Protocol-compatible without edits. The method is intentionally
    # **not** declared on the Protocol in Phase 1 — making it mandatory
    # would force every shipped pack to add boilerplate that buys nothing
    # until M2 wires the bundle into the turn loop.


# ---------------------------------------------------------------------------
# Registry — the ONE place new packs plug in.
# ---------------------------------------------------------------------------


CAPABILITY_PACK_REGISTRY: dict[str, CapabilityPack] = {}
"""Pack id -> concrete pack instance.

Populated at import time by each concrete pack module. Phase 3 boot
validator (``resolve_pack_ids_for_app``) raises on unknown ids.
"""

_TOOL_TO_PACK_ID: dict[str, str] = {}
_IMPORTED_PACK_MODULES: set[str] = set()


def register_pack(pack: CapabilityPack) -> None:
    """Install a concrete pack. Raises on duplicate pack id."""

    if pack.pack_id in CAPABILITY_PACK_REGISTRY:
        existing = CAPABILITY_PACK_REGISTRY[pack.pack_id]
        if existing is pack:
            return
        raise RuntimeError(
            f"CapabilityPack id collision: {pack.pack_id!r} already registered "
            f"by {type(existing).__name__}; cannot re-register with {type(pack).__name__}."
        )
    CAPABILITY_PACK_REGISTRY[pack.pack_id] = pack
    for spec in pack.tool_specs():
        name = spec.get('name')
        if isinstance(name, str):
            _TOOL_TO_PACK_ID[name] = pack.pack_id


@cache
def _discover_pack_modules() -> tuple[str, ...]:
    """Return every concrete capability-pack module in ``app.services``.

    Phase 8's extension proof should not require editing Harness Core when a
    new pack lands. The convention is intentionally narrow: any module under
    ``app.services`` ending in ``*_pack.py`` (except this registry module) is
    imported for its ``register_pack(...)`` side effect.
    """

    services_root = Path(__file__).resolve().parents[1]
    app_root = services_root.parent
    modules: list[str] = []
    for path in services_root.rglob('*_pack.py'):
        if path.name == 'capability_pack.py':
            continue
        relpath = path.relative_to(app_root).with_suffix('')
        modules.append('app.' + '.'.join(relpath.parts))
    return tuple(sorted(modules))


def ensure_packs_registered() -> None:
    """Import every concrete pack module so its ``register_pack`` call runs."""

    for module_name in _discover_pack_modules():
        if module_name in _IMPORTED_PACK_MODULES:
            continue
        importlib.import_module(module_name)
        _IMPORTED_PACK_MODULES.add(module_name)


def resolve_pack_for_tool(tool_name: str) -> CapabilityPack | None:
    """Return the registered pack that owns ``tool_name``."""

    ensure_packs_registered()
    pack_id = _TOOL_TO_PACK_ID.get(tool_name)
    if pack_id is None:
        return None
    return CAPABILITY_PACK_REGISTRY.get(pack_id)


def resolve_pack_id_for_tool(tool_name: str) -> str | None:
    """Return the ``pack_id`` of the pack that owns ``tool_name``, or ``None``.

    Convenience wrapper for call sites that need the id string rather than
    the pack object (e.g. envelope capability field, event routing).
    """

    ensure_packs_registered()
    return _TOOL_TO_PACK_ID.get(tool_name)


def resolve_pack_ids_for_app(capabilities: list[str] | None, app_id: str) -> list[str]:
    """Validate ``capabilities`` and return the canonical pack id list.

    Unknown-pack behaviour is a hard fail: the plan's Phase 3 acceptance
    gate pins this as "validator raises on unknown pack id in any app
    config".

    ``capabilities`` is normally ``App.config.chat.capabilities``; when
    empty or ``None`` the default (every registered pack id) is used.
    """

    ensure_packs_registered()

    if not capabilities:
        return sorted(CAPABILITY_PACK_REGISTRY.keys())
    unknown = [pid for pid in capabilities if pid not in CAPABILITY_PACK_REGISTRY]
    if unknown:
        raise RuntimeError(
            f"Unknown capability pack id(s) in App.config.chat.capabilities "
            f"for app {app_id!r}: {unknown}. Registered packs: "
            f"{sorted(CAPABILITY_PACK_REGISTRY)}."
        )
    return list(capabilities)


# ---------------------------------------------------------------------------
# Generic harness → pack extension hooks (Phase 9 §3.A)
# ---------------------------------------------------------------------------
#
# These helpers let Harness Core collect optional contributions from the
# active packs without knowing any pack's id or private helper surface. A
# pack that has nothing to add returns an empty structure; Harness Core
# merges everything uniformly.


def _iter_active_packs(pack_ids: Sequence[str]) -> list['CapabilityPack']:
    ensure_packs_registered()
    return [
        CAPABILITY_PACK_REGISTRY[pid]
        for pid in pack_ids
        if pid in CAPABILITY_PACK_REGISTRY
    ]


def collect_question_hints(
    *,
    pack_ids: Sequence[str],
    question: str,
    app_id: str,
    semantic_model: Mapping[str, Any],
) -> dict[str, Any]:
    """Collect per-turn question-analysis hints from every active pack.

    Harness Core calls this while assembling the outer-agent prompt.
    Each pack that defines ``question_hints(question, app_id, semantic_model)``
    contributes ``{context, needs_discovery}``; the aggregate joins the
    non-empty ``context`` strings and OR's the ``needs_discovery`` flags.
    Packs without the hook (or with nothing to say) return
    ``{context: '', needs_discovery: False}``.
    """

    contexts: list[str] = []
    needs_discovery = False
    for pack in _iter_active_packs(pack_ids):
        hook = getattr(pack, 'question_hints', None)
        if hook is None:
            continue
        try:
            hint = hook(
                question=question,
                app_id=app_id,
                semantic_model=semantic_model,
            )
        except TypeError:
            # Packs that declare question_hints with positional args fall
            # through; harness-core never hand-edits their signature.
            continue
        if not isinstance(hint, Mapping):
            continue
        context = hint.get('context')
        if isinstance(context, str) and context.strip():
            contexts.append(context)
        if bool(hint.get('needs_discovery')):
            needs_discovery = True
    return {
        'context': '\n\n'.join(contexts),
        'needs_discovery': needs_discovery,
    }


def collect_tool_schema_enums(
    *,
    pack_ids: Sequence[str],
    app_id: str,
    semantic_model: Mapping[str, Any],
) -> dict[str, list[str]]:
    """Collect bounded tool-arg enums contributed by every active pack.

    The outer-agent tool schema uses these lists to hard-bound string
    parameters (``table``, ``dimension``, ``surface_key``, ...). Each pack
    owns the vocabulary behind its own tool args; harness-core merges the
    per-param lists (de-duplicated, sorted) without knowing which pack
    contributed which value.
    """

    merged: dict[str, set[str]] = {}
    for pack in _iter_active_packs(pack_ids):
        hook = getattr(pack, 'tool_schema_enums', None)
        if hook is None:
            continue
        contributed = hook(app_id=app_id, semantic_model=semantic_model)
        if not isinstance(contributed, Mapping):
            continue
        for param_name, values in contributed.items():
            if not isinstance(values, (list, tuple, set, frozenset)):
                continue
            bucket = merged.setdefault(str(param_name), set())
            for value in values:
                if isinstance(value, str) and value:
                    bucket.add(value)
    return {name: sorted(values) for name, values in merged.items()}


def collect_pack_projections(
    *,
    pack_ids: Sequence[str],
    scope: Any,
) -> list[Any]:
    """Collect optional per-pack projections contributed to the bundle.

    Phase 1 / M1 assembly hook. Each pack that implements
    ``contribute_projection(scope)`` returns a :class:`PackProjection`;
    packs without the hook return ``None`` here and are filtered out so
    the bundle builder can assume a homogenous list. Mirrors the shape of
    :func:`collect_question_hints` / :func:`collect_tool_schema_enums`
    so harness-core never special-cases a pack id.
    """

    projections: list[Any] = []
    for pack in _iter_active_packs(pack_ids):
        hook = getattr(pack, 'contribute_projection', None)
        if hook is None:
            continue
        try:
            projection = hook(scope)
        except Exception:  # pragma: no cover - surfaced by pack tests
            _log.exception(
                'capability pack %r contribute_projection raised',
                getattr(pack, 'pack_id', type(pack).__name__),
            )
            continue
        if projection is None:
            continue
        projections.append(projection)
    return projections


async def validate_all_app_pack_ids(db: Any) -> None:
    """Boot-time validator — iterate every active app and validate its
    ``App.config.chat.capabilities`` through ``resolve_pack_ids_for_app``.

    Plan §Phase-3 acceptance gate: "validator raises on unknown pack id
    in any app config". Running this at process startup means drift in
    a single app config fails boot loudly instead of waiting for the
    first turn that happens to hit that app.
    """

    from sqlalchemy import select

    from app.models.application import Application
    from app.schemas.app_config import AppConfig

    ensure_packs_registered()

    result = await db.execute(
        select(Application.slug, Application.config).where(Application.is_active.is_(True))
    )
    errors: list[str] = []
    for slug, raw_config in result.all():
        try:
            app_config = AppConfig.model_validate(raw_config or {})
        except Exception as exc:  # corrupt config — surface but don't crash early
            errors.append(f'{slug}: failed to parse App.config: {exc}')
            continue
        caps = app_config.chat.capabilities or None
        try:
            resolve_pack_ids_for_app(caps, app_id=slug)
        except RuntimeError as exc:
            errors.append(str(exc))
    if errors:
        raise RuntimeError(
            'Sherlock capability-pack validation failed:\n  - '
            + '\n  - '.join(errors),
        )


# ---------------------------------------------------------------------------
# Phase 7 — Async jobs as first-class harness outcomes
# ---------------------------------------------------------------------------


SHERLOCK_SUBMISSION_SURFACE = 'sherlock'
"""Value written to ``jobs.submission_context.surface`` by ``submit_pack_job``.

The chat handler's ``assemble_context`` filters on this literal to select
jobs that should appear in the per-turn pending-jobs block. Other surfaces
MAY write their own surface literal; the jobs pipeline treats the field as
opaque.
"""


async def submit_pack_job(
    *,
    db: Any,
    pack_id: str,
    capability: str,
    job_type: str,
    params: Mapping[str, Any],
    summary: str,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app_id: str,
    session_id: uuid.UUID | str,
    turn_id: uuid.UUID | str | None,
    preview_payload: Mapping[str, Any] | None = None,
) -> ToolEnvelopeModel:
    """Phase 7 harness helper — submit a platform job and return a §6.2 envelope.

    Packs call this when a tool needs async work. The returned envelope has
    ``outcome.kind = 'job_submitted'`` and ``outcome.job = {id, status}``; the
    outer agent observes it, finishes the turn, and stops (no polling).

    The platform jobs pipeline records the job verbatim with
    ``submission_context = {surface: 'sherlock', session_id, turn_id}`` so
    ``assemble_context`` can surface completion on subsequent turns without
    adding Sherlock-specific foreign keys to the jobs schema.
    """

    from app.models.job import BackgroundJob
    from app.services.job_worker import get_job_submission_metadata

    job_params = dict(params)
    try:
        metadata = get_job_submission_metadata(job_type, job_params)
    except ValueError as exc:
        _log.warning('submit_pack_job rejected job_type=%s: %s', job_type, exc)
        return error_envelope(
            capability=capability,  # type: ignore[arg-type]
            reason_code='JOB_SUBMISSION_FAILED',
            summary=f'Unable to submit {job_type}: {exc}',
            payload={'job_type': job_type},
        )

    # Injected auth context (mirrors routes/jobs.py:94-97). Runners read
    # these back from params; Sherlock jobs are no different.
    job_params['tenant_id'] = str(tenant_id)
    job_params['user_id'] = str(user_id)
    resolved_app_id = metadata['app_id'] or app_id or ''
    if resolved_app_id:
        job_params['app_id'] = resolved_app_id

    submission_context = {
        'surface': SHERLOCK_SUBMISSION_SURFACE,
        'session_id': str(session_id),
        'turn_id': str(turn_id) if turn_id is not None else None,
        'pack_id': pack_id,
    }

    job = BackgroundJob(
        job_type=job_type,
        params=job_params,
        status='queued',
        progress={'current': 0, 'total': 0, 'message': ''},
        submission_context=submission_context,
        app_id=resolved_app_id,
        priority=metadata['priority'],
        queue_class=metadata['queue_class'],
        max_attempts=metadata['max_attempts'],
        tenant_id=tenant_id,
        user_id=user_id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    _log.info(
        'submit_pack_job pack=%s tool_job_type=%s job_id=%s session=%s turn=%s',
        pack_id, job_type, job.id, session_id, turn_id,
    )

    return build_envelope(
        status='ok',
        summary=summary,
        kind='job_submitted',
        capability=capability,  # type: ignore[arg-type]
        job={'id': str(job.id), 'status': 'queued'},
        payload=dict(preview_payload or {}),
    )


def render_job_line(job: Any) -> str:
    """Default one-line rendering for the per-turn pending-jobs block.

    Packs override ``describe_job`` in their CapabilityPack implementation
    to add domain-specific detail; callers that don't override fall back
    here. Format is stable so the context section is deterministic across
    turns (Rule 10 — cacheable-prefix integrity).
    """

    job_id = getattr(job, 'id', None) or (job.get('id') if isinstance(job, dict) else None)
    job_type = getattr(job, 'job_type', None) or (
        job.get('job_type') if isinstance(job, dict) else None
    )
    status = getattr(job, 'status', None) or (
        job.get('status') if isinstance(job, dict) else None
    ) or 'unknown'
    progress = getattr(job, 'progress', None) or (
        job.get('progress') if isinstance(job, dict) else None
    ) or {}
    msg = ''
    if isinstance(progress, dict):
        current = progress.get('current') or 0
        total = progress.get('total') or 0
        message = progress.get('message') or ''
        if total:
            msg = f' ({current}/{total}{" " + message if message else ""})'
        elif message:
            msg = f' ({message})'
    return f'- job {job_id} type={job_type} status={status}{msg}'
