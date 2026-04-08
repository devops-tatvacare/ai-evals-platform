"""Inside Sales call quality evaluation runner.

Two-step pipeline per call:
  1. TRANSCRIBE: Download MP3 from Ozonetel S3 → send audio to LLM via generate_with_audio → get transcript
  2. EVALUATE:   Send transcript + rubric prompt to LLM via generate_json → get dimension scores

Uses run_parallel engine for bounded concurrency, cancellation, and progress tracking.
Creates one EvalRun with eval_type='call_quality', one ThreadEvaluation per call.
"""

import logging
import time
import uuid
from typing import Any

import httpx
from sqlalchemy import select, update

from app.models.eval_run import EvalRun, ThreadEvaluation
from app.models.evaluator import Evaluator
from app.services.evaluators.output_schema_utils import find_primary_field
from app.services.evaluators.llm_base import (
    LoggingLLMWrapper,
    create_llm_provider,
)
from app.services.evaluators.runner_utils import (
    save_api_log,
    create_eval_run,
    finalize_eval_run,
)
from app.services.evaluators.schema_generator import generate_json_schema
from app.services.evaluators.response_parser import _safe_parse_json
from app.services.evaluators.settings_helper import get_llm_settings_from_db
from app.services.evaluators.parallel_engine import run_parallel
from app.services.job_worker import (
    safe_error_message,
    update_job_progress,
)
from app.services.inside_sales_dataset_resolver import (
    InsideSalesCallFilters,
    resolve_call_selection,
)
from app.services.inside_sales_eval_linkage import (
    build_inside_sales_run_config_snapshot,
    build_inside_sales_source_snapshot,
)

logger = logging.getLogger(__name__)


def _async_session():
    from app.database import async_session

    return async_session()


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

    # ── Create EvalRun immediately (visible in UI) ───────────────
    eval_run_id = uuid.uuid4()
    initial_config_snapshot = build_inside_sales_run_config_snapshot(
        run_name=run_name,
        run_description=run_description,
        call_selection=call_selection,
        transcription_config=transcription_config,
        llm_config=llm_config,
        requested_evaluator_ids=[str(evaluator_id) for evaluator_id in evaluator_ids],
    )

    await create_eval_run(
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
    llm = LoggingLLMWrapper(provider, log_callback=save_api_log)
    llm.set_context(str(eval_run_id))

    await update_job_progress(
        job_id, 0, 1, "Fetching calls from LeadSquared...",
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

    async with _async_session() as db:
        selection = await resolve_call_selection(
            InsideSalesCallFilters(
                date_from=call_selection.get("date_from", ""),
                date_to=call_selection.get("date_to", ""),
                agents=tuple(agent_list),
                prospect_id=call_selection.get("prospect_id"),
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
            update(EvalRun)
            .where(EvalRun.id == eval_run_id, EvalRun.tenant_id == tenant_id)
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

        # Fetch lead name (individual GetById — reliable 1:1 mapping)
        prospect_id = call.get("prospectId", "")
        if prospect_id:
            from app.services.lsq_client import fetch_lead_by_id
            lead_info = await fetch_lead_by_id(prospect_id)
            lead_name = f"{lead_info.get('firstName', '')} {lead_info.get('lastName', '')}".strip()
            call["_leadName"] = lead_name or prospect_id[:8]
        else:
            call["_leadName"] = ""

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
        overall_score = None

        for evaluator in evaluators:
            prompt = evaluator["prompt"].replace("{{transcript}}", transcript)
            output_schema = evaluator["output_schema"]
            json_schema = generate_json_schema(output_schema)

            raw_result = await worker_llm.generate_json(
                prompt=prompt,
                json_schema=json_schema,
            )

            parsed = _safe_parse_json(raw_result) if isinstance(raw_result, str) else raw_result
            if not parsed:
                parsed = {"error": "Failed to parse LLM response"}

            main_field = find_primary_field(output_schema)
            score = parsed.get(main_field["key"]) if main_field else None

            if overall_score is None and isinstance(score, (int, float)):
                overall_score = score

            eval_outputs.append({
                "evaluator_id": evaluator["id"],
                "evaluator_name": evaluator["name"],
                "output": parsed,
            })

        # ── Step 3: Persist ThreadEvaluation ─────────────────
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
            db.add(ThreadEvaluation(
                run_id=eval_run_id,
                thread_id=call_id,
                result={
                    "evaluations": eval_outputs,
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
            "overall_score": overall_score,
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
    scores: list[float] = []

    for r in results:
        if isinstance(r, BaseException):
            failed += 1
            # Store error as ThreadEvaluation for visibility
            async with _async_session() as db:
                db.add(ThreadEvaluation(
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
                if isinstance(r.get("overall_score"), (int, float)):
                    scores.append(r["overall_score"])

    avg_score = round(sum(scores) / len(scores), 1) if scores else None

    # ── Finalize ─────────────────────────────────────────────────

    duration_ms = (time.monotonic() - start_time) * 1000
    summary = {
        "total": total,
        "evaluated": evaluated,
        "failed": failed,
        "skipped_no_recording": skipped_no_recording,
        "average_score": avg_score,
        "evaluator_names": [e["name"] for e in evaluators],
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

    return {
        "status": final_status,
        "run_id": str(eval_run_id),
        **summary,
    }
