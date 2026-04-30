"""Inside Sales call quality evaluation runner.

Two-step pipeline per call:
  1. TRANSCRIBE: Download MP3 from Ozonetel S3 → send audio to LLM via generate_with_audio → get transcript
  2. EVALUATE:   Send transcript + rubric prompt to LLM via generate_json → get dimension scores

Uses run_parallel engine for bounded concurrency, cancellation, and progress tracking.
Creates one EvaluationRun with eval_type='call_quality', one EvaluationRunThreadResult per call.
"""

import logging
import time
import uuid
from typing import Any

import httpx
from sqlalchemy import select, update

from app.models.eval_run import EvaluationRun, EvaluationRunThreadResult
from app.models.evaluator import Evaluator
from app.models.source_records import CrmLeadRecord
from app.services.evaluators.output_schema_utils import find_primary_field, primary_score
from app.services.evaluators.llm_base import (
    LoggingLLMWrapper,
    create_llm_provider,
)
from app.services.evaluators.runner_utils import (
    save_api_log,
    promote_eval_run_to_running,
    finalize_eval_run,
    make_usage_callback,
    set_usage_call_purpose,
)
from app.services.evaluators.schema_generator import generate_json_schema
from app.services.evaluators.response_parser import _safe_parse_json
from app.services.analytics.signal_taxonomy import SIGNAL_TYPES
from app.services.evaluators.settings_helper import get_llm_settings_from_db
from app.services.evaluators.parallel_engine import run_parallel
from app.services.job_worker import (
    safe_error_message,
    update_job_progress,
)
from app.services.inside_sales_dataset_resolver import InsideSalesCallFilters
from app.services.inside_sales_source_resolver import (
    resolve_call_selection_from_source as resolve_call_selection,
)
from app.services.inside_sales_sync import INSIDE_SALES_APP_ID
from app.services.inside_sales_eval_linkage import (
    build_inside_sales_run_config_snapshot,
    build_inside_sales_source_snapshot,
)

logger = logging.getLogger(__name__)


def _async_session():
    from app.database import async_session

    return async_session()


# ── Signal-extraction schema augmentation (Roadmap 01 §8.5) ──────────


def _signal_field_description() -> str:
    """Describe the signals contract, embedding the live vocabulary.

    Reading the vocabulary from ``SIGNAL_TYPES`` here keeps the LLM
    instruction in lockstep with the populator's coercion target —
    adding a new signal type only updates ``signal_taxonomy.py``.
    """
    enum_inline = ", ".join(sorted(SIGNAL_TYPES))
    return (
        "Inside-sales coaching signals extracted from this call. Emit "
        "one entry per discrete signal (commitments, intents, "
        "objections, outcomes, etc.). Use one of the controlled "
        f"signal_type values: {enum_inline}. If none of the controlled "
        "types fit, use 'other_notable_signal' and describe the raw "
        "label inside attributes.signal_type_raw. Return an empty "
        "array when no signals are present in the call."
    )


def _build_signals_field_definition() -> dict:
    """Build the runtime-only ``signals`` field appended to every evaluator schema.

    Shape conforms 1:1 with ``analytics.fact_lead_signal`` rows so the
    populator can write each entry without further normalization beyond
    signal-type vocabulary coercion.
    """
    return {
        "key": "signals",
        "type": "array",
        "description": _signal_field_description(),
        "arrayItemSchema": {
            "itemType": "object",
            "properties": [
                {
                    "key": "signal_type",
                    "type": "string",
                    "description": (
                        "Canonical signal type from the controlled "
                        "vocabulary."
                    ),
                },
                {
                    "key": "signal_value",
                    "type": "string",
                    "description": (
                        "Optional canonical short value (e.g. 'hot' for "
                        "purchase_intent, 'price' for objection)."
                    ),
                },
                {
                    "key": "signal_value_numeric",
                    "type": "number",
                    "description": (
                        "Optional numeric value (e.g. sentiment score "
                        "in the range -1..1)."
                    ),
                },
                {
                    "key": "signal_at",
                    "type": "string",
                    "description": (
                        "Optional ISO-8601 timestamp for time-bound "
                        "signals like committed-followup datetime."
                    ),
                },
                {
                    "key": "confidence",
                    "type": "number",
                    "description": "Optional 0..1 confidence score.",
                },
                {
                    "key": "supporting_quote",
                    "type": "string",
                    "description": (
                        "Optional verbatim transcript span supporting "
                        "the signal."
                    ),
                },
                {
                    "key": "attributes",
                    "type": "object",
                    "description": (
                        "Optional free-form metadata, including "
                        "signal_type_raw when signal_type is "
                        "'other_notable_signal'."
                    ),
                },
            ],
        },
    }


def _augment_output_schema_with_signals(output_schema: list[dict]) -> list[dict]:
    """Return a runtime-only copy of ``output_schema`` with ``signals`` appended.

    The original ``output_schema`` is the evaluator's stored rubric and
    is consumed by ``primary_score()`` / visible breakdown — it MUST
    NOT be mutated. The runner builds an augmented copy here only to
    drive the LLM's structured-output enforcement (Roadmap 01 §8.5
    invariant).
    """
    augmented: list[dict] = list(output_schema or [])
    augmented.append(_build_signals_field_definition())
    return augmented


def _normalize_signal_entry(raw: dict) -> dict | None:
    """Coerce one LLM signal dict to a canonical shape; drop if unusable."""
    if not isinstance(raw, dict):
        return None
    signal_type = (raw.get("signal_type") or "").strip()
    if not signal_type:
        return None
    return {
        "signal_type": signal_type,
        "signal_value": raw.get("signal_value") or None,
        "signal_value_numeric": raw.get("signal_value_numeric"),
        "signal_at": raw.get("signal_at") or None,
        "confidence": raw.get("confidence"),
        "supporting_quote": raw.get("supporting_quote") or None,
        "attributes": raw.get("attributes") or {},
    }


def merge_thread_signals(eval_outputs: list[dict]) -> list[dict]:
    """Merge per-evaluator ``output['signals']`` into one canonical array.

    De-duplication key: ``(signal_type, signal_value, signal_at,
    supporting_quote)``. The first occurrence wins so per-evaluator
    ordering is preserved within the canonical array.

    Roadmap 01 §8.5 invariant: this canonical merged array is what
    ``populate-analytics`` reads from
    ``platform.evaluation_run_thread_results.result.signals``. Nested
    per-evaluator copies in ``result.evaluations[*].output.signals``
    are never read by downstream extractors.
    """
    merged: list[dict] = []
    seen: set[tuple] = set()
    for ev in eval_outputs or []:
        output = (ev or {}).get("output") or {}
        signals = output.get("signals") or []
        if not isinstance(signals, list):
            continue
        for raw in signals:
            entry = _normalize_signal_entry(raw)
            if entry is None:
                continue
            key = (
                entry["signal_type"],
                entry["signal_value"],
                entry["signal_at"],
                entry["supporting_quote"],
            )
            if key in seen:
                continue
            seen.add(key)
            merged.append(entry)
    return merged


# ── Transcription prompt builder ─────────────────────────────────────


def _build_transcription_prompt(config: dict) -> tuple[str, str]:
    """Build transcription prompt and system prompt from wizard config.

    Returns: (prompt, system_prompt)
    """
    lang = config.get("language", "auto")
    diarize = config.get("speakerDiarization", True)
    preserve_cs = config.get("preserveCodeSwitching", True)

    # Language-specific instruction — "auto" gets its own branch, not interpolated
    _lang_instruction: dict[str, str] = {
        "hi": "The call is in Hindi. Transcribe in Hindi.",
        "en": "The call is in English. Transcribe in English.",
        "hi-en": "The call is in Hindi-English (code-mixed). Transcribe in the original mix as spoken.",
        "auto": "Detect the language(s) spoken and transcribe faithfully in the original language(s) — do not guess or default to any specific language.",
    }
    lang_instruction = _lang_instruction.get(lang, f"The call is in {lang}. Transcribe in {lang}.")

    _sys_lang: dict[str, str] = {
        "hi": "Hindi",
        "en": "English",
        "hi-en": "Hindi-English code-mixed",
        "auto": "multilingual (language auto-detected from audio)",
    }
    sys_lang = _sys_lang.get(lang, lang)

    parts = [
        "Transcribe this sales call recording.",
        lang_instruction,
    ]
    if diarize:
        parts.append(
            "Identify two speakers: the sales agent and the customer/lead. "
            "Use the format [Agent]: ... and [Lead]: ... for each turn."
        )
    parts.append(
        "Include all dialogue, including small talk and greetings. "
        "Do not translate — preserve the original language exactly."
    )
    if preserve_cs:
        parts.append("Preserve code-switching between languages exactly as spoken.")

    sys_prompt = (
        f"You are an expert multilingual transcriptionist specializing in sales calls. "
        f"Language: {sys_lang}. "
        f"Transcribe accurately{', with speaker diarization (mark [Agent] and [Lead] turns)' if diarize else ''}. "
        f"Never translate — output the spoken language verbatim."
    )

    return " ".join(parts), sys_prompt


# ── Main entry point ─────────────────────────────────────────────────


async def run_inside_sales_evaluation(
    job_id: str,
    params: dict,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict:
    """Evaluate inside sales calls against rubric evaluators."""
    start_time = time.monotonic()

    # ── Extract params ───────────────────────────────────────────
    call_selection = params.get("call_selection", {})
    evaluator_ids = params.get("evaluator_ids", [])
    llm_config = params.get("llm_config", {})
    transcription_config = params.get("transcription_config", {})
    parallel_workers = params.get("parallel_workers", 3)
    run_name = params.get("run_name", "Inside Sales Eval")
    run_description = params.get("run_description", "")

    # Reuse the submit-time placeholder id when present so the queued row
    # already visible in the Runs list gets promoted in place.
    _placeholder_id = params.get("eval_run_id")
    eval_run_id = uuid.UUID(_placeholder_id) if _placeholder_id else uuid.uuid4()
    initial_config_snapshot = build_inside_sales_run_config_snapshot(
        run_name=run_name,
        run_description=run_description,
        call_selection=call_selection,
        transcription_config=transcription_config,
        llm_config=llm_config,
        requested_evaluator_ids=[str(evaluator_id) for evaluator_id in evaluator_ids],
    )

    await promote_eval_run_to_running(
        id=eval_run_id,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id="inside-sales",
        eval_type="call_quality",
        job_id=job_id,
        llm_provider=llm_config.get("provider"),
        llm_model=llm_config.get("model"),
        config=initial_config_snapshot,
        batch_metadata={
            "run_name": run_name,
            "run_description": run_description,
            "call_selection": call_selection,
            "evaluator_count": len(evaluator_ids),
        },
    )

    await update_job_progress(
        job_id, 0, 1, "Loading evaluators...",
        run_id=str(eval_run_id),
    )

    # ── Load evaluators ──────────────────────────────────────────
    evaluators: list[dict[str, Any]] = []
    async with _async_session() as db:
        from types import SimpleNamespace
        from app.services.access_control import readable_scope_clause

        for eid in evaluator_ids:
            ev = await db.scalar(
                select(Evaluator).where(
                    Evaluator.id == eid,
                    readable_scope_clause(
                        Evaluator,
                        SimpleNamespace(tenant_id=tenant_id, user_id=user_id, app_access=frozenset()),
                    ),
                )
            )
            if ev:
                evaluators.append({
                    "id": str(ev.id),
                    "name": ev.name,
                    "prompt": ev.prompt,
                    "output_schema": ev.output_schema,
                })

    if not evaluators:
        await finalize_eval_run(
            eval_run_id, tenant_id,
            status="failed",
            duration_ms=(time.monotonic() - start_time) * 1000,
            error_message="No evaluators found",
        )
        return {"status": "failed", "error": "No evaluators found"}

    # ── Resolve LLM credentials ──────────────────────────────────
    llm_settings = await get_llm_settings_from_db(
        tenant_id, user_id,
        app_id=None,
        auth_intent="managed_job",
        provider_override=llm_config.get("provider"),
    )

    provider = create_llm_provider(
        provider=llm_settings.get("provider", llm_config.get("provider", "gemini")),
        api_key=llm_settings.get("api_key", ""),
        model_name=llm_config.get("model", llm_settings.get("selected_model", "")),
        temperature=llm_config.get("temperature", 0.1),
        service_account_path=llm_settings.get("service_account_path", ""),
    )
    usage_cb = make_usage_callback(
        tenant_id=tenant_id,
        user_id=user_id,
        app_id="inside-sales",
        owner_type="eval_run",
        owner_id=eval_run_id,
        default_call_purpose='inside_sales_evaluation',
    )
    llm = LoggingLLMWrapper(
        provider, log_callback=save_api_log, usage_callback=usage_cb,
    )
    llm.set_context(str(eval_run_id))

    await update_job_progress(
        job_id, 0, 1, "Loading calls for evaluation...",
        run_id=str(eval_run_id),
    )

    mode = call_selection.get("selection_mode", "all")
    if mode not in {"all", "sample", "specific"}:
        mode = "all"

    agent_list = call_selection.get("agents") or []
    if isinstance(agent_list, str):
        agent_list = [agent_list] if agent_list else []

    if not agent_list and call_selection.get("agent"):
        legacy_agent = str(call_selection["agent"]).strip()
        if legacy_agent:
            agent_list = [legacy_agent]

    duration_min = call_selection.get("duration_min")
    parsed_duration_min = int(duration_min) if duration_min not in (None, "", 0) else None
    duration_max = call_selection.get("duration_max")
    parsed_duration_max = int(duration_max) if duration_max not in (None, "", 0) else None
    minimum_duration_floor = 10 if call_selection.get("min_duration") else None

    event_codes = call_selection.get("event_codes")
    parsed_event_codes: tuple[int, ...] | None = None
    if isinstance(event_codes, str) and event_codes.strip():
        parsed_event_codes = tuple(int(code.strip()) for code in event_codes.split(",") if code.strip())
    elif isinstance(event_codes, list):
        parsed_event_codes = tuple(int(code) for code in event_codes)

    # Multi-value prospect IDs. Frontend (post-2026-04-30) sends `prospect_ids` (list);
    # legacy single-value `prospect_id` is still honored for any in-flight job payloads.
    prospect_ids_raw = call_selection.get("prospect_ids")
    if isinstance(prospect_ids_raw, list) and prospect_ids_raw:
        parsed_prospect_ids = tuple(str(pid) for pid in prospect_ids_raw if pid)
    else:
        legacy_prospect_id = call_selection.get("prospect_id")
        parsed_prospect_ids = (str(legacy_prospect_id),) if legacy_prospect_id else ()

    async with _async_session() as db:
        selection = await resolve_call_selection(
            InsideSalesCallFilters(
                agents=tuple(agent_list),
                prospect_ids=parsed_prospect_ids,
                direction=call_selection.get("direction"),
                status=call_selection.get("status"),
                duration_min=parsed_duration_min,
                duration_max=parsed_duration_max,
                has_recording=call_selection.get("has_recording"),
                event_codes=parsed_event_codes,
            ),
            selection_mode=mode,
            selected_call_ids=call_selection.get("selected_call_ids", []),
            sample_size=int(call_selection.get("sample_size", 20) or 20),
            skip_evaluated=bool(call_selection.get("skip_evaluated")),
            min_duration_seconds=minimum_duration_floor,
            tenant_id=tenant_id,
            user_id=user_id,
            db=db,
        )

    calls = selection.records
    skipped_evaluated = selection.skipped_evaluated
    skipped_no_recording = selection.skipped_no_recording
    resolved_config_snapshot = build_inside_sales_run_config_snapshot(
        run_name=run_name,
        run_description=run_description,
        call_selection=call_selection,
        transcription_config=transcription_config,
        llm_config=llm_config,
        requested_evaluator_ids=[str(evaluator_id) for evaluator_id in evaluator_ids],
        resolved_evaluators=evaluators,
        selected_calls=calls,
    )

    async with _async_session() as db:
        await db.execute(
            update(EvaluationRun)
            .where(EvaluationRun.id == eval_run_id, EvaluationRun.tenant_id == tenant_id)
            .values(
                config=resolved_config_snapshot,
                batch_metadata={
                    "run_name": run_name,
                    "run_description": run_description,
                    "call_selection": call_selection,
                    "evaluator_count": len(evaluators),
                    "selected_call_count": len(calls),
                    "selected_call_ids": [call.get("activityId", "") for call in calls if call.get("activityId")],
                },
            )
        )
        await db.commit()

    logger.info("Resolved %d calls for evaluation", len(calls))
    if skipped_evaluated:
        logger.info("Skipped %d already-evaluated calls", skipped_evaluated)

    total = len(calls)
    logger.info(
        "After filters: %d calls to evaluate (%d skipped, no recording)",
        total, skipped_no_recording,
    )

    if total == 0:
        await finalize_eval_run(
            eval_run_id, tenant_id,
            status="completed",
            duration_ms=(time.monotonic() - start_time) * 1000,
            summary={
                "total": 0, "evaluated": 0, "failed": 0,
                "skipped_no_recording": skipped_no_recording,
            },
        )
        return {"status": "completed", "total": 0, "evaluated": 0}

    # Resolve every prospect's display name from the synced lead mirror in
    # one query and stash it on each call dict. This replaces a per-worker
    # LSQ ``Leads.GetById`` round trip — live LSQ I/O is reserved for the
    # sync job.
    prospect_ids = sorted(
        {call.get("prospectId", "") for call in calls if call.get("prospectId")}
    )
    lead_name_map: dict[str, str] = {}
    if prospect_ids:
        async with _async_session() as db:
            rows = (await db.execute(
                select(
                    CrmLeadRecord.prospect_id,
                    CrmLeadRecord.first_name,
                    CrmLeadRecord.last_name,
                ).where(
                    CrmLeadRecord.tenant_id == tenant_id,
                    CrmLeadRecord.app_id == INSIDE_SALES_APP_ID,
                    CrmLeadRecord.prospect_id.in_(prospect_ids),
                )
            )).all()
        for prospect_id, first_name, last_name in rows:
            full_name = f"{(first_name or '').strip()} {(last_name or '').strip()}".strip()
            if full_name:
                lead_name_map[prospect_id] = full_name
    for call in calls:
        prospect_id = call.get("prospectId", "")
        call["_leadName"] = lead_name_map.get(prospect_id) or (prospect_id[:8] if prospect_id else "")

    # ── Build transcription prompt once (shared across all calls) ─
    transcription_prompt, transcription_sys = _build_transcription_prompt(transcription_config)

    # ── Worker function for run_parallel ─────────────────────────

    async def _evaluate_one_call(index: int, call: dict) -> dict:
        """Transcribe + evaluate a single call.

        Returns result dict for post-run aggregation.
        Each worker gets its own LLM clone for thread-safe context.
        """
        call_id = call.get("activityId", f"call-{index}")
        recording_url = call.get("recordingUrl", "")

        # Thread-safe LLM clone
        worker_llm = llm.clone_for_thread(call_id)

        # ── Step 1: Download + Transcribe ────────────────────
        async with httpx.AsyncClient(timeout=60) as http:
            audio_resp = await http.get(recording_url)
            audio_resp.raise_for_status()
            audio_bytes = audio_resp.content

        mime_type = "audio/mpeg"
        if recording_url.lower().endswith(".wav"):
            mime_type = "audio/wav"

        set_usage_call_purpose(worker_llm, 'transcription', stage_index=0)
        transcript = await worker_llm.generate_with_audio(
            prompt=transcription_prompt,
            audio_bytes=audio_bytes,
            mime_type=mime_type,
            system_prompt=transcription_sys,
        )

        if not transcript or not transcript.strip():
            transcript = "[Transcription returned empty result]"

        # ── Step 2: Evaluate against each rubric ─────────────
        eval_outputs: list[dict] = []
        per_evaluator_scores: dict[str, float | None] = {}

        for evaluator in evaluators:
            prompt = evaluator["prompt"].replace("{{transcript}}", transcript)
            output_schema = evaluator["output_schema"]
            # Build a runtime-only augmented schema with the required
            # top-level ``signals`` array. The original ``output_schema``
            # stays intact for ``primary_score()`` / visible breakdown
            # (Roadmap 01 §8.5).
            augmented_schema = _augment_output_schema_with_signals(output_schema)
            json_schema = generate_json_schema(augmented_schema)

            set_usage_call_purpose(worker_llm, 'evaluation', stage_index=1)
            raw_result = await worker_llm.generate_json(
                prompt=prompt,
                json_schema=json_schema,
            )

            if isinstance(raw_result, str):
                parsed, _repaired = _safe_parse_json(raw_result)
            else:
                parsed = raw_result
            if not parsed:
                parsed = {"error": "Failed to parse LLM response"}

            per_evaluator_scores[str(evaluator["id"])] = primary_score(parsed, output_schema)

            eval_outputs.append({
                "evaluator_id": evaluator["id"],
                "evaluator_name": evaluator["name"],
                "output": parsed,
            })

        numeric_scores = [s for s in per_evaluator_scores.values() if isinstance(s, (int, float))]
        call_overall_score = sum(numeric_scores) / len(numeric_scores) if numeric_scores else None

        # ── Step 3: Persist EvaluationRunThreadResult ─────────────────
        agent_name = call.get("agentName", "")
        agent_lsq_id = call.get("agentId") or ""
        agent_id = None
        source_snapshot = build_inside_sales_source_snapshot(call)
        async with _async_session() as db:
            if agent_lsq_id:
                from app.services.lsq_client import upsert_external_agent
                agent_id = await upsert_external_agent(
                    db, tenant_id=tenant_id, lsq_user_id=agent_lsq_id, name=agent_name,
                )
            # Canonical merged top-level ``signals`` array (Roadmap 01
            # §8.5). This is what ``populate-analytics`` reads from
            # ``platform.evaluation_run_thread_results.result.signals``;
            # nested per-evaluator copies in
            # ``result.evaluations[*].output.signals`` are never read by
            # downstream extractors.
            thread_signals = merge_thread_signals(eval_outputs)
            db.add(EvaluationRunThreadResult(
                run_id=eval_run_id,
                thread_id=call_id,
                result={
                    "evaluations": eval_outputs,
                    "signals": thread_signals,
                    "transcript": transcript,
                    "call_metadata": {
                        "agent_id": str(agent_id) if agent_id else None,
                        "agent": agent_name,
                        "lead": call.get("_leadName", "") or call.get("prospectId", "")[:8],
                        "prospect_id": call.get("prospectId", ""),
                        "direction": call.get("direction"),
                        "duration": call.get("durationSeconds"),
                        "recording_url": recording_url,
                    },
                    "source_snapshot": source_snapshot,
                },
                success_status=True,
            ))
            await db.commit()

        return {
            "call_id": call_id,
            "overall_score": call_overall_score,
            "per_evaluator_scores": per_evaluator_scores,
            "is_error": False,
        }

    # ── Progress callback for run_parallel ────────────────────────

    async def _progress_cb(current: int, total_count: int, message: str):
        await update_job_progress(job_id, current, total_count, message)

    def _progress_msg(ok: int, err: int, current: int, tot: int) -> str:
        return f"Call {current}/{tot} ({ok} ok, {err} errors)"

    # ── Run with parallel engine ─────────────────────────────────

    try:
        results = await run_parallel(
            items=calls,
            worker=_evaluate_one_call,
            concurrency=parallel_workers,
            job_id=job_id,
            tenant_id=tenant_id,
            progress_callback=_progress_cb,
            progress_message=_progress_msg,
            inter_item_delay=0.5,
        )
    except Exception as e:
        logger.error("run_parallel failed: %s", e)
        await finalize_eval_run(
            eval_run_id, tenant_id,
            status="failed",
            duration_ms=(time.monotonic() - start_time) * 1000,
            error_message=safe_error_message(e),
        )
        return {"status": "failed", "error": safe_error_message(e)}

    # ── Collect results ──────────────────────────────────────────

    evaluated = 0
    failed = 0
    # Per-evaluator score lists keyed by evaluator_id, in the order evaluators were attached.
    per_evaluator_score_lists: dict[str, list[float]] = {
        str(e["id"]): [] for e in evaluators
    }

    for r in results:
        if isinstance(r, BaseException):
            failed += 1
            # Store error as EvaluationRunThreadResult for visibility
            async with _async_session() as db:
                db.add(EvaluationRunThreadResult(
                    run_id=eval_run_id,
                    thread_id=f"error-{failed}",
                    result={"error": safe_error_message(r)},
                    success_status=False,
                ))
                await db.commit()
        elif isinstance(r, dict):
            if r.get("is_error"):
                failed += 1
            else:
                evaluated += 1
                call_scores = r.get("per_evaluator_scores") or {}
                for ev_id, score in call_scores.items():
                    if isinstance(score, (int, float)):
                        per_evaluator_score_lists.setdefault(ev_id, []).append(float(score))

    evaluator_summaries: list[dict] = []
    evaluator_averages: list[float] = []
    for ev in evaluators:
        ev_id = str(ev["id"])
        scores_for_ev = per_evaluator_score_lists.get(ev_id, [])
        primary = find_primary_field(ev["output_schema"]) or {}
        avg = round(sum(scores_for_ev) / len(scores_for_ev), 1) if scores_for_ev else None
        if avg is not None:
            evaluator_averages.append(avg)
        evaluator_summaries.append({
            "id": ev_id,
            "name": ev["name"],
            "primary_field": primary.get("key"),
            "primary_type": primary.get("type"),
            "average_score": avg,
            "completed": len(scores_for_ev),
        })

    avg_score = (
        round(sum(evaluator_averages) / len(evaluator_averages), 1)
        if evaluator_averages else None
    )

    # ── Finalize ─────────────────────────────────────────────────

    duration_ms = (time.monotonic() - start_time) * 1000
    summary = {
        "total": total,
        "evaluated": evaluated,
        "failed": failed,
        "skipped_no_recording": skipped_no_recording,
        "average_score": avg_score,
        "evaluator_names": [e["name"] for e in evaluators],
        "evaluators": evaluator_summaries,
        "overall_score": avg_score,
    }

    final_status = "completed" if failed == 0 else "completed_with_errors"

    await finalize_eval_run(
        eval_run_id, tenant_id,
        status=final_status,
        duration_ms=duration_ms,
        summary=summary,
        config={
            **resolved_config_snapshot,
            "evaluator_count": len(evaluators),
            "evaluator_name": evaluators[0]["name"] if evaluators else "",
            "call_count": total,
            "parallel_workers": parallel_workers,
        },
    )

    # Submit analytics population job (fire-and-forget)
    if final_status in ("completed", "completed_with_errors"):
        try:
            from app.services.analytics import submit_analytics_job
            async with _async_session() as db:
                await submit_analytics_job(db=db, run_id=eval_run_id, app_id="inside-sales", tenant_id=tenant_id, user_id=user_id)
                await db.commit()
        except Exception:
            logger.warning("Failed to submit analytics job for run %s", eval_run_id, exc_info=True)

    return {
        "status": final_status,
        "run_id": str(eval_run_id),
        **summary,
    }
