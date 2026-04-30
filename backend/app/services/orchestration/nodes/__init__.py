"""Auto-import every node module so @register_node fires at app startup.

Add new node modules here. Order doesn't matter — registry collisions raise.
"""
import logging as _logging

from app.services.orchestration.nodes import (  # noqa: F401
    source_cohort_query,
    source_event_trigger,
    filter_eligibility,
    filter_consent_gate,
    logic_conditional,
    logic_split,
    logic_wait,
    logic_merge,
    core_webhook_out,
    sink_complete,
)

# Boot-time visibility — confirm registration in live process logs.
from app.services.orchestration.node_registry import NODE_REGISTRY as _REG
_shared = sorted(k[1] for k in _REG if k[0] == "*" and not k[1].startswith("test."))
_logging.getLogger(__name__).info(
    "orchestration nodes registered: count=%d types=%s", len(_shared), _shared
)
