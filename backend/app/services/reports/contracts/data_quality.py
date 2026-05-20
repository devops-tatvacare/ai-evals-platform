"""Phase 2 reporting — DataQualityReport contract.

Surfaces the "this report is partial" signal explicitly on every
``PlatformRunReportPayload``. Without it, missing evaluator schemas, missing
kaira summary keys, or composed-but-absent sections silently produce blank
cards that look indistinguishable from real zeros.

Ownership of the three fields:
  * ``missing_inputs`` — owned by ``*ReportService`` subclasses. Each service
    knows its domain's required inputs (evaluator_id for inside-sales, summary
    keys for kaira, result/summary keys for voice-rx) and emits markers.
  * ``section_status`` — owned by ``data_quality_finalizer.finalize_data_quality``.
    The composition boundary in ``report_generation_service._compose_single_run_payload``
    is the only place that sees the configured + produced + composed + exported
    section-id sets together; per Phase 1 SoC, services must not duplicate.
  * ``overall`` — derived by the finalizer from the union of the two above.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.base import CamelModel


DataQualityOverall = Literal["complete", "partial", "degraded"]

# Per-section quality marker. ``empty`` = configured but no producer payload
# AND no composed section (the producer didn't emit anything for it).
# ``dropped_from_export`` = export.sectionIds references an id that survived
# config validation but does not appear in the composed sections — the PDF
# silently omits it today (``document_composer.py:432-436``).
DataQualitySectionStatus = Literal["complete", "empty", "dropped_from_export"]


class DataQualityReport(CamelModel):
    overall: DataQualityOverall = "complete"
    missing_inputs: list[str] = Field(default_factory=list)
    section_status: dict[str, DataQualitySectionStatus] = Field(default_factory=dict)
