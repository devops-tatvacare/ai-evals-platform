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

from typing import Any, Mapping, Protocol, Sequence, runtime_checkable

from app.services.chat_engine.artifact import Outcome


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


# ---------------------------------------------------------------------------
# Registry — the ONE place new packs plug in.
# ---------------------------------------------------------------------------


CAPABILITY_PACK_REGISTRY: dict[str, CapabilityPack] = {}
"""Pack id -> concrete pack instance.

Populated at import time by each concrete pack module. Phase 3 boot
validator (``resolve_pack_ids_for_app``) raises on unknown ids.
"""

_TOOL_TO_PACK_ID: dict[str, str] = {}


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


_REQUIRED_PACK_IDS: tuple[str, ...] = ('analytics', 'report_builder')


def ensure_packs_registered() -> None:
    """Import the concrete pack modules so their ``register_pack`` calls run.

    Import-at-call keeps ``capability_pack.py`` cycle-free: the concrete
    packs reference ``tool_handlers``, which references chat_engine
    artifact + reason_codes. The registry is idempotent.

    Checks each required pack id individually; a partially-populated
    registry (e.g. ``analytics`` imported by a pack-local module before
    ``report_builder``) still completes on the next call.
    """

    if all(pid in CAPABILITY_PACK_REGISTRY for pid in _REQUIRED_PACK_IDS):
        return
    # Intentional side-effect: each module calls ``register_pack`` at import.
    if 'analytics' not in CAPABILITY_PACK_REGISTRY:
        import app.services.report_builder.analytics_pack  # noqa: F401
    if 'report_builder' not in CAPABILITY_PACK_REGISTRY:
        import app.services.report_builder.report_builder_pack  # noqa: F401


def resolve_pack_for_tool(tool_name: str) -> CapabilityPack | None:
    """Return the registered pack that owns ``tool_name``."""

    ensure_packs_registered()
    pack_id = _TOOL_TO_PACK_ID.get(tool_name)
    if pack_id is None:
        return None
    return CAPABILITY_PACK_REGISTRY.get(pack_id)


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


async def validate_all_app_pack_ids(db: Any) -> None:
    """Boot-time validator — iterate every active app and validate its
    ``App.config.chat.capabilities`` through ``resolve_pack_ids_for_app``.

    Plan §Phase-3 acceptance gate: "validator raises on unknown pack id
    in any app config". Running this at process startup means drift in
    a single app config fails boot loudly instead of waiting for the
    first turn that happens to hit that app.
    """

    from sqlalchemy import select

    from app.models.app import App
    from app.schemas.app_config import AppConfig

    ensure_packs_registered()

    result = await db.execute(
        select(App.slug, App.config).where(App.is_active.is_(True))
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
