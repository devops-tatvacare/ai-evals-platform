"""Auto-import every node module so @register_node fires at app startup."""
import logging as _logging

from app.services.orchestration.nodes import (  # noqa: F401
    source_dataset,
    source_event_trigger,
    source_saved_cohort,
    filter_eligibility,
    filter_consent_gate,
    logic_conditional,
    logic_split,
    logic_wait,
    logic_merge,
    core_webhook_out,
    messaging_send_whatsapp_template,
    voice_place_call,
    sink_complete,
)

from app.services.orchestration.node_registry import NODE_REGISTRY as _REG
_shared = sorted(k[1] for k in _REG if k[0] == "*" and not k[1].startswith("test."))
_logging.getLogger(__name__).info(
    "orchestration nodes registered: shared=%d %s",
    len(_shared), _shared,
)
