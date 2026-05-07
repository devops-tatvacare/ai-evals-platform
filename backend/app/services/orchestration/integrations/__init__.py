"""Orchestration channel integrations + ServiceRegistry factory.

Phase 10 commit 2: env-backed credential wiring is gone. Bolna / WATI /
LSQ / SMS services are resolved per-call from ``ctx.connections`` against
``orchestration.provider_connections`` rows, not built once at boot from
``settings``. The only field still wired here is ``clinical_outbox`` —
the always-on writer for clinical pathway nodes (no external creds).
"""
from __future__ import annotations

from app.services.orchestration.node_context import ServiceRegistry


def build_service_registry() -> ServiceRegistry:
    reg = ServiceRegistry()

    # ClinicalOutboxWriter has no external creds — always wired (Phase 9).
    from app.services.orchestration.integrations.clinical_outbox import (
        ClinicalOutboxWriter,
    )
    reg.clinical_outbox = ClinicalOutboxWriter()

    return reg
