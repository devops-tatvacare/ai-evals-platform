"""Phase 2 reporting — central data_quality finalizer.

The composition boundary in ``report_generation_service._compose_single_run_payload``
is the only place that sees all four section-id sets together (configured,
producer-emitted, composed, exported). Per Phase 1 SoC, this logic lives here
and is not duplicated inside ``*ReportService`` subclasses; subclasses only
contribute ``missing_inputs`` markers for their domain's required inputs.

Inputs and what they mean
--------------------------
* ``configured_section_ids`` — ``app.config.analytics.single_run.sections[].id``.
  The declared section composition.
* ``produced_section_payload_ids`` — keys of the dict passed to
  ``compose_sections`` (i.e. ``_serialize_section_payloads`` output keys).
  These are what the producer actually emitted.
* ``composed_section_ids`` — ids on ``PlatformRunReportPayload.sections`` after
  the composer ran. A configured section absent here means the producer didn't
  emit a payload for it AND no fallback resolved.
* ``exported_section_ids`` — ``export_config.section_ids`` per the report config.
  An entry that's not in ``composed_section_ids`` is silently dropped from the
  PDF today by ``document_composer.py:432-436``.
"""

from __future__ import annotations

from collections.abc import Iterable

from app.services.reports.contracts.data_quality import (
    DataQualityReport,
    DataQualitySectionStatus,
)


def finalize_data_quality(
    *,
    missing_inputs: Iterable[str],
    configured_section_ids: Iterable[str],
    produced_section_payload_ids: Iterable[str],
    composed_section_ids: Iterable[str],
    exported_section_ids: Iterable[str],
) -> DataQualityReport:
    missing = list(missing_inputs)
    configured = list(configured_section_ids)  # order matters for readability
    produced = set(produced_section_payload_ids)
    composed = set(composed_section_ids)
    exported = list(exported_section_ids)

    section_status: dict[str, DataQualitySectionStatus] = {}

    # Configured-but-not-composed → producer emitted nothing AND no fallback
    # resolved. Mark as 'empty'.
    for sid in configured:
        if sid not in composed and sid not in produced:
            section_status[sid] = "empty"

    # Exported-but-not-composed → silently dropped by document_composer:432-436.
    # Phase 1 boot validator catches the export.sectionIds ⊄ sections[].id case
    # at config time; this check catches the runtime case where the section is
    # configured + exported but the producer didn't emit it.
    for sid in exported:
        if sid not in composed:
            # 'dropped_from_export' is the more specific signal — overwrite 'empty'
            # if we already marked it that way for the same id.
            section_status[sid] = "dropped_from_export"

    has_missing = bool(missing)
    has_degraded_sections = bool(section_status)

    if has_missing and has_degraded_sections:
        overall = "degraded"
    elif has_missing or has_degraded_sections:
        overall = "partial"
    else:
        overall = "complete"

    return DataQualityReport(
        overall=overall,
        missing_inputs=missing,
        section_status=section_status,
    )
