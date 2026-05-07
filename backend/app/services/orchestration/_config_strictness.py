"""Phase 14 / Phase D — strict-mode policy for orchestration node configs.

Every node ``_Config(BaseModel)`` resolves its ``model_config`` through this
helper. The flag-gated rollout (Phase 14 §Migration & rollout) keeps a
single switch that operations can flip per environment after the audit
script confirms zero offending workflows.

Behavior:
  * ``ORCHESTRATION_BUILDER_V2=true`` (any case) → ``ConfigDict(extra="forbid")``.
    Pydantic rejects unknown keys at validation time. The publish-time
    validator surfaces the offending field name in the structured 400 error.
  * unset / any other value → ``ConfigDict()`` (Pydantic default ``extra="ignore"``).
    Unknown keys silently dropped; preserves Phase 13 behaviour.

Why a flag rather than unconditional strictness: ``contract_audit.py``
needs to scan production-like data first. Forbidding extras unconditionally
on import would crash the publish path for every workflow that carries a
field we forgot to declare. The flag is the rollback hatch.

The flag is read on import; tests that need to flip it use
``pytest.MonkeyPatch.setenv`` together with a module reload because module
import time is when ``model_config`` is computed. See
``test_strict_node_config_unittest.py`` for the pattern.

TODO (Phase 16): codegen Pydantic from a single source of truth and drop
this helper — strictness is a property of the generated model, not a
runtime decision.
"""
from __future__ import annotations

import os

from pydantic import ConfigDict


def _strict_enabled() -> bool:
    return os.environ.get("ORCHESTRATION_BUILDER_V2", "").strip().lower() == "true"


def strict_node_config_dict() -> ConfigDict:
    """Return ``ConfigDict(extra='forbid')`` when the flag is on, default
    ``ConfigDict()`` otherwise. Module import-time evaluation — call from
    every ``_Config(BaseModel)`` so node configs share a single policy."""
    if _strict_enabled():
        return ConfigDict(extra="forbid")
    return ConfigDict()


__all__ = ["strict_node_config_dict"]
