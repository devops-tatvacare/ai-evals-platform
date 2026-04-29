"""Typed data shapes for the Sherlock assembly layer (Phase 1 / M1).

All types here are frozen, hashable-where-reasonable dataclasses so they
can be cached and safely passed across request boundaries. They form the
stable contract between :mod:`scope_guard`, :mod:`platform_ontology`,
:mod:`bundle`, and each pack's ``contribute_projection()``.

Nothing in this module touches the database or the live harness — it is
pure data plumbing.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Mapping

from app.services.sherlock.provenance import ProvenancedValue


# ---------------------------------------------------------------------------
# Platform ontology record shapes (read from DB by PlatformOntology)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OntologyClassRecord:
    """One ``sherlock_ontology_classes`` row, read-only."""

    id: uuid.UUID
    name: str
    parent_name: str | None
    description: str | None
    version: int


@dataclass(frozen=True)
class EntityTypeRecord:
    """One ``sherlock_ontology_entity_types`` row, read-only.

    ``safety`` is one of ``safe_first_pass``, ``explicit_only``, ``unsafe``
    (plan §5.1). ``app_id`` is ``None`` when the row is platform baseline
    and applies to every app in scope.
    """

    id: uuid.UUID
    tenant_id: uuid.UUID | None
    app_id: str | None
    name: str
    ontology_class_name: str
    role: str | None
    safety: str
    description: str | None
    examples: tuple[Any, ...]


@dataclass(frozen=True)
class ResolverRecord:
    """One ``sherlock_entity_resolvers`` row, read-only."""

    id: uuid.UUID
    tenant_id: uuid.UUID | None
    app_id: str | None
    key: str
    entity_type: str
    description: str | None
    source: str
    config: Mapping[str, Any]
    safety: str


# ---------------------------------------------------------------------------
# Scope — the output of ScopeGuard
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ScopeDenial:
    """One denied scope candidate, with the reason.

    ``reason_code`` is a short enum-ish token — ``app_not_allowed``,
    ``app_unknown``, ``app_inactive``, ``capability_unknown`` — so UIs
    and tests can branch on it without string-matching messages.
    """

    reason_code: str
    message: str
    app_id: str | None = None


@dataclass(frozen=True)
class ScopeContext:
    """Deterministic request scope.

    Single-app invariant (plan §1.1): ``effective_app_id`` is **exactly
    one** app id for a live turn. ``requested_app_ids`` and
    ``allowed_app_ids`` may carry more, but the live scope is singular.
    """

    tenant_id: uuid.UUID
    user_id: uuid.UUID
    allowed_app_ids: tuple[str, ...]
    requested_app_ids: tuple[str, ...]
    effective_app_id: str
    effective_pack_ids: tuple[str, ...]
    scope_hints: Mapping[str, ProvenancedValue] = field(default_factory=dict)
    scope_denials: tuple[ScopeDenial, ...] = field(default_factory=tuple)
    # Stable representation of the alias-authority output for the resolved
    # app. Consumed by BundleBuilder, never re-derived downstream.
    app_aliases: tuple[str, ...] = field(default_factory=tuple)

    def as_event_payload(self) -> dict[str, Any]:
        """Stable shape for the ``scope.resolved`` runtime event.

        The harness will persist this payload verbatim in M2. Keep the
        shape conservative — callers pin on exact keys.
        """
        return {
            'tenant_id': str(self.tenant_id),
            'user_id': str(self.user_id),
            'allowed_app_ids': list(self.allowed_app_ids),
            'requested_app_ids': list(self.requested_app_ids),
            'effective_app_id': self.effective_app_id,
            'effective_pack_ids': list(self.effective_pack_ids),
            'app_aliases': list(self.app_aliases),
            'scope_hints': {
                key: value.to_dict() for key, value in self.scope_hints.items()
            },
            'scope_denials': [
                {
                    'reason_code': denial.reason_code,
                    'message': denial.message,
                    'app_id': denial.app_id,
                }
                for denial in self.scope_denials
            ],
        }


# ---------------------------------------------------------------------------
# Pack projection — the output of CapabilityPack.contribute_projection
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ClassProjection:
    """Pack-local storage binding for one ontology class.

    ``storage`` names the pack-local table / index / node label; it is
    opaque to the platform. ``identifier_field`` names the column / key
    that identifies a row inside that storage. ``contract_id`` is
    populated when the projection produces an artifact contract instead
    of a row set (e.g. ``analytics.chart.v1``).
    """

    ontology_class: str
    storage: str | None = None
    identifier_field: str | None = None
    contract_id: str | None = None
    # Optional per-field safety override (e.g. ``run_name`` →
    # ``explicit_only`` on ``Evaluation.Run``). Platform ontology still
    # owns the default; this lets a pack pin the flag for its own storage
    # when the manifest already says so.
    field_safety: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class PackProjection:
    """What a pack contributes to the bundle for one resolved scope.

    Returned by ``CapabilityPack.contribute_projection(scope)``. Every
    field is opaque to the platform except the merged tool specs and
    enums, which land in the final ScopedBundle.

    Cache-key: ``pack_version`` participates directly in the bundle
    cache key so a manifest or pack bump invalidates cleanly.
    """

    pack_id: str
    pack_version: str
    projected_classes: tuple[ClassProjection, ...] = field(default_factory=tuple)
    semantic_slice: Mapping[str, Any] = field(default_factory=dict)
    tool_specs: tuple[Mapping[str, Any], ...] = field(default_factory=tuple)
    tool_schema_enums: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    question_hints: str = ''


# ---------------------------------------------------------------------------
# The assembled bundle — output of BundleBuilder.build
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ScopedBundle:
    """Request-scoped, per-turn-ephemeral assembly result.

    Cache key is ``(tenant_id, effective_app_id, ontology_version,
    frozen pack_versions)``; the builder materializes this tuple before
    any work.
    """

    scope: ScopeContext
    ontology_classes: tuple[OntologyClassRecord, ...]
    entity_types: tuple[EntityTypeRecord, ...]
    resolvers: tuple[ResolverRecord, ...]
    pack_projections: tuple[PackProjection, ...]
    tool_specs: tuple[Mapping[str, Any], ...]
    tool_schema_enums: Mapping[str, tuple[str, ...]]
    question_hints: str
    cache_key: tuple[Any, ...]
    ontology_version: int

    def safety_by_entity(self) -> dict[str, str]:
        """Flatten platform + pack safety flags into a simple lookup.

        Later platform rows override earlier ones if multiple scopes seed
        the same entity name (app-specific row beats NULL-app baseline).
        ``PlatformOntology.scoped`` returns rows in baseline-first order
        so the precedence falls out naturally here.
        """
        out: dict[str, str] = {}
        for record in self.entity_types:
            out[record.name] = record.safety
        return out
