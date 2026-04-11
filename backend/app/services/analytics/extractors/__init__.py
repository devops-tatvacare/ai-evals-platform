"""Extractor registry — maps eval_type to extraction function."""
from __future__ import annotations
from typing import TYPE_CHECKING

from app.services.analytics.extractors.adversarial import extract_adversarial
from app.services.analytics.extractors.batch_thread import extract_batch_thread
from app.services.analytics.extractors.call_quality import extract_call_quality
from app.services.analytics.extractors.custom_eval import extract_custom
from app.services.analytics.extractors.full_eval import extract_full_eval

if TYPE_CHECKING:
    from typing import Callable

# Registry populated by extractor modules.
# Key: eval_type string, Value: extraction function
EXTRACTORS: dict[str, Callable] = {
    "batch_thread": extract_batch_thread,
    "call_quality": extract_call_quality,
    "batch_adversarial": extract_adversarial,
    "full_evaluation": extract_full_eval,
    "custom": extract_custom,
}
