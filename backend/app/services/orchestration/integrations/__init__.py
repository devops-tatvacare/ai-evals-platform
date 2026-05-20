"""Orchestration channel integrations + ServiceRegistry factory."""
from __future__ import annotations

from app.services.orchestration.node_context import ServiceRegistry


def build_service_registry() -> ServiceRegistry:
    return ServiceRegistry()
