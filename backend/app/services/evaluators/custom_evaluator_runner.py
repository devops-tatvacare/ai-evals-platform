"""Custom evaluator runner — executes user-defined evaluators on listings or chat sessions.

Creates eval_runs rows (eval_type='custom') as the single source of truth.
Called by the job worker when processing 'evaluate-custom' jobs.

Also contains run_custom_eval_batch() for the 'evaluate-custom-batch' job type
(merged from voice_rx_batch_custom_runner.py).
"""
import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, update

from app.database import async_session
from app.models.listing import Listing
from app.models.chat import ChatSession, ChatMessage
from app.models.eval_run import EvalRun
from app.models.evaluator import Evaluator
from app.models.file_record import FileRecord
from app.services.file_storage import file_storage
from app.services.evaluators.llm_base import (
    BaseLLMProvider, LoggingLLMWrapper, create_llm_provider,
)
from app.services.evaluators.prompt_resolver import resolve_prompt
from app.services.evaluators.schema_generator import generate_json_schema
from app.services.evaluators.response_parser import _safe_parse_json
from app.services.evaluators.runner_utils import (
    save_api_log, create_eval_run, finalize_eval_run, find_primary_field,
)
from app.services.job_worker import (
    is_job_cancelled, JobCancelledError, safe_error_message, update_job_progress,
)

logger = logging.getLogger(__name__)


# ── Score Extraction ─────────────────────────────────────────────────


def _extract_scores(output: dict, output_schema: list[dict]) -> Optional[dict]:
    """Extract scores from evaluator output for summary persistence.

    Strategy:
      1. Find primary metric via find_primary_field (isMainMetric > first number > first text).
      2. Find reasoning field: explicit role='reasoning' first, then substring heuristic.
      3. max_score from thresholds only — no arbitrary defaults.
    """
    if not output:
        return None

    main_field = find_primary_field(output_schema)

    # ── Reasoning field: explicit role, then heuristic ────────────
    _REASONING_KEYWORDS = ("reason", "explanation", "comment", "justification", "notes")
    reasoning_field = next((f for f in output_schema if f.get("role") == "reasoning"), None)
    if not reasoning_field:
        for f in output_schema:
            if any(kw in f["key"].lower() for kw in _REASONING_KEYWORDS):
                reasoning_field = f
                break
    reasoning = str(output.get(reasoning_field["key"], "")) if reasoning_field else None

    if not main_field:
        return {
            "overall_score": None,
            "max_score": None,
            "breakdown": output,
            "reasoning": reasoning,
            "metadata": None,
        }

    overall_score = output.get(main_field["key"])

    # ── Breakdown: all visible fields ─────────────────────────────
    breakdown = {
        f["key"]: output[f["key"]]
        for f in output_schema
        if f.get("displayMode") != "hidden" and f["key"] in output
    }

    # ── max_score: derive from thresholds only ────────────────────
    max_score = None
    if main_field.get("type") == "number":
        thresholds = main_field.get("thresholds")
        if thresholds:
            max_score = thresholds.get("green")

    return {
        "overall_score": overall_score if overall_score is not None else None,
        "max_score": max_score,
        "breakdown": breakdown or None,
        "reasoning": reasoning,
        "metadata": {
            "main_metric_key": main_field["key"],
            "main_metric_type": main_field.get("type"),
            "thresholds": main_field.get("thresholds"),
        },
    }


# ── Single Custom Evaluator ─────────────────────────────────────────


async def run_custom_evaluator(job_id, params: dict) -> dict:
    """Execute a custom evaluator on a voice-rx listing or kaira-bot session.

    Params:
        evaluator_id: str   - UUID of evaluator definition
        listing_id: str     - UUID of listing (voice-rx flow)
        session_id: str     - UUID of chat session (kaira-bot flow)
        app_id: str         - "voice-rx" or "kaira-bot"
    """
    start_time = time.monotonic()
    evaluator_id = params["evaluator_id"]
    listing_id = params.get("listing_id")
    session_id = params.get("session_id")
    app_id = params.get("app_id", "voice-rx")
    thinking = params.get("thinking", "low")
    is_session_flow = session_id is not None

    entity_ref = session_id if is_session_flow else listing_id

    # Create eval_run record immediately so it's visible in UI
    eval_run_id = uuid.uuid4()

    await create_eval_run(
        id=eval_run_id,
        app_id=app_id,
        eval_type="custom",
        job_id=job_id,
        listing_id=uuid.UUID(listing_id) if listing_id and not is_session_flow else None,
        session_id=uuid.UUID(session_id) if session_id and is_session_flow else None,
        evaluator_id=uuid.UUID(str(evaluator_id)),
    )

    # Update job progress with run_id for frontend tracking
    await update_job_progress(
        job_id, 0, 2, "Loading evaluator...",
        evaluator_id=str(evaluator_id), run_id=str(eval_run_id),
    )

    # ── Load evaluator + entity ──────────────────────────────────
    listing = None
    session = None
    messages = []
    audio_bytes = None
    mime_type = "audio/mpeg"

    async with async_session() as db:
        evaluator = await db.get(Evaluator, evaluator_id)
        if not evaluator:
            raise ValueError(f"Evaluator {evaluator_id} not found")

        if is_session_flow:
            session = await db.get(ChatSession, session_id)
            if not session:
                raise ValueError(f"ChatSession {session_id} not found")
            result = await db.execute(
                select(ChatMessage)
                .where(ChatMessage.session_id == session.id)
                .order_by(ChatMessage.created_at)
            )
            messages = [
                {"role": m.role, "content": m.content}
                for m in result.scalars().all()
            ]
        else:
            listing = await db.get(Listing, listing_id)
            if not listing:
                raise ValueError(f"Listing {listing_id} not found")

    # ── Load audio bytes if available (voice-rx only) ────────────
    if listing:
        audio_file_meta = listing.audio_file
        if audio_file_meta and audio_file_meta.get("id"):
            async with async_session() as db:
                file_record = await db.get(FileRecord, audio_file_meta["id"])
                if file_record:
                    audio_bytes = await file_storage.read(file_record.storage_path)
                    mime_type = file_record.mime_type or audio_file_meta.get("mimeType", "audio/mpeg")

    # ── Resolve prompt variables ─────────────────────────────────
    if is_session_flow:
        resolve_ctx = {"messages": messages}
    else:
        resolve_ctx = {
            "listing": {
                "id": str(listing.id),
                "appId": listing.app_id,
                "transcript": listing.transcript,
                "sourceType": listing.source_type,
                "apiResponse": listing.api_response,
            },
        }
    resolved = resolve_prompt(evaluator.prompt, resolve_ctx)
    prompt_text = resolved["prompt"]

    # Fail-fast: unresolved non-audio variables mean the listing is missing required data
    unresolved = [v for v in resolved["unresolved_variables"] if v != "{{audio}}"]
    if unresolved:
        var_names = ", ".join(unresolved)
        raise ValueError(
            f"Cannot run evaluator '{evaluator.name}': required data not available on this listing. "
            f"Unresolved variables: {var_names}"
        )

    has_audio = "{{audio}}" in evaluator.prompt and audio_bytes is not None
    prompt_text = prompt_text.replace("{{audio}}", "[Audio file attached]")

    # ── Generate JSON schema from output definition ──────────────
    json_schema = generate_json_schema(evaluator.output_schema)

    # ── Resolve LLM settings ────────────────────────────────────
    from app.services.evaluators.settings_helper import get_llm_settings_from_db
    db_settings = await get_llm_settings_from_db(
        app_id=None, key="llm-settings", auth_intent="managed_job",
        provider_override=params.get("provider") or None,
    )

    model = params.get("model") or evaluator.model_id or db_settings["selected_model"]
    factory_kwargs = {}
    if db_settings["provider"] == "azure_openai":
        factory_kwargs["azure_endpoint"] = db_settings.get("azure_endpoint", "")
        factory_kwargs["api_version"] = db_settings.get("api_version", "")
    inner = create_llm_provider(
        provider=db_settings["provider"],
        api_key=db_settings["api_key"],
        model_name=model,
        temperature=0.2,
        service_account_path=db_settings.get("service_account_path", ""),
        **factory_kwargs,
    )
    llm: BaseLLMProvider = LoggingLLMWrapper(inner, log_callback=save_api_log)
    if params.get("timeouts"):
        llm.set_timeouts(params["timeouts"])
    llm.set_context(str(eval_run_id))

    # Store config snapshot
    config_snapshot = {
        "prompt": evaluator.prompt,
        "resolved_prompt": prompt_text,
        "output_schema": evaluator.output_schema,
        "model_id": model,
        "provider": db_settings["provider"],
        "evaluator_name": evaluator.name,
        "auth_method": db_settings["auth_method"],
        "thinking": thinking,
    }

    # Update eval_run with config and LLM info
    async with async_session() as db:
        await db.execute(
            update(EvalRun).where(EvalRun.id == eval_run_id).values(
                config=config_snapshot,
                llm_provider=db_settings["provider"],
                llm_model=model,
            )
        )
        await db.commit()

    output = None
    response_text = None

    try:
        if await is_job_cancelled(job_id):
            raise JobCancelledError("Job was cancelled by user")

        # Update progress
        await update_job_progress(
            job_id, 1, 2, "Running evaluator...",
            evaluator_id=str(evaluator_id), run_id=str(eval_run_id),
        )

        # ── Call LLM ─────────────────────────────────────────────
        if has_audio and audio_bytes:
            response_text = await llm.generate_with_audio(
                prompt=prompt_text,
                audio_bytes=audio_bytes,
                mime_type=mime_type,
                json_schema=json_schema,
                thinking=thinking,
            )
            output, _was_repaired = _safe_parse_json(response_text)
        else:
            output = await llm.generate_json(
                prompt=prompt_text,
                json_schema=json_schema,
                thinking=thinking,
            )
            response_text = json.dumps(output, ensure_ascii=False)

        if await is_job_cancelled(job_id):
            raise JobCancelledError("Job was cancelled by user")

        # ── Build completed result ──────────────────────────────
        duration_ms = (time.monotonic() - start_time) * 1000
        scores = _extract_scores(output or {}, evaluator.output_schema)

        await finalize_eval_run(
            eval_run_id,
            status="completed",
            duration_ms=duration_ms,
            result={
                "output": output,
                "rawRequest": prompt_text,
                "rawResponse": response_text,
            },
            summary=scores,
        )

    except JobCancelledError:
        await finalize_eval_run(
            eval_run_id,
            status="cancelled",
            duration_ms=(time.monotonic() - start_time) * 1000,
            error_message="Cancelled",
        )
        logger.info("Custom evaluator %s cancelled for %s", evaluator_id, entity_ref)
        raise

    except Exception as e:
        error_msg = safe_error_message(e)
        await finalize_eval_run(
            eval_run_id,
            status="failed",
            duration_ms=(time.monotonic() - start_time) * 1000,
            error_message=error_msg,
            result={"rawRequest": prompt_text} if prompt_text else None,
        )
        logger.error("Custom evaluator %s failed for %s: %s", evaluator_id, entity_ref, error_msg)
        raise

    duration = time.monotonic() - start_time
    result = {
        "evaluator_id": str(evaluator_id),
        "eval_run_id": str(eval_run_id),
        "status": "completed",
        "duration_seconds": round(duration, 2),
    }
    if is_session_flow:
        result["session_id"] = str(session_id)
    else:
        result["listing_id"] = str(listing_id)
    return result


# ── Batch Custom Evaluator ───────────────────────────────────────────
# Merged from voice_rx_batch_custom_runner.py


async def run_custom_eval_batch(job_id, params: dict) -> dict:
    """Run multiple custom evaluators on a single listing/session.

    Params:
        evaluator_ids: list[str]  - UUIDs of evaluators to run
        listing_id: str           - UUID of listing (voice-rx)
        session_id: str           - UUID of session (kaira-bot) — optional
        app_id: str               - "voice-rx" or "kaira-bot"
        parallel: bool            - Run evaluators in parallel (default: True)
        timeouts: dict            - LLM timeout config
    """
    evaluator_ids = params["evaluator_ids"]
    listing_id = params.get("listing_id")
    session_id = params.get("session_id")
    app_id = params.get("app_id", "voice-rx")
    parallel = params.get("parallel", True)

    # Validate evaluators exist
    async with async_session() as db:
        valid_ids = []
        for eid in evaluator_ids:
            ev = await db.get(Evaluator, eid)
            if ev:
                valid_ids.append(eid)
            else:
                logger.warning("Evaluator %s not found, skipping", eid)

        if not valid_ids:
            raise ValueError("No valid evaluators found")

    total = len(valid_ids)
    completed = 0
    errors = 0
    eval_run_ids: list[str] = []
    first_run_id_written = False

    await update_job_progress(job_id, 0, total, f"Starting {total} evaluators...")

    async def _run_one(eid: str, index: int) -> dict:
        """Run one evaluator, creating its own EvalRun via run_custom_evaluator."""
        nonlocal completed, errors, first_run_id_written

        if await is_job_cancelled(job_id):
            raise JobCancelledError("Batch cancelled")

        sub_params = {
            "evaluator_id": eid,
            "app_id": app_id,
            "thinking": params.get("thinking", "low"),
            "timeouts": params.get("timeouts"),
            "provider": params.get("provider"),
            "model": params.get("model"),
        }
        if listing_id:
            sub_params["listing_id"] = listing_id
        if session_id:
            sub_params["session_id"] = session_id

        try:
            result = await run_custom_evaluator(job_id=job_id, params=sub_params)
            run_id = result.get("eval_run_id")
            if run_id:
                eval_run_ids.append(run_id)

            # Write first completed run_id to job progress so frontend can redirect
            if run_id and not first_run_id_written:
                first_run_id_written = True
                await update_job_progress(
                    job_id, completed + 1, total,
                    f"Completed {completed + 1}/{total}...",
                    run_id=run_id,
                )

            completed += 1
            return result
        except JobCancelledError:
            raise
        except Exception as e:
            errors += 1
            logger.error("Batch custom eval %s failed: %s", eid, e)
            return {"evaluator_id": eid, "status": "failed", "error": safe_error_message(e)}

    try:
        if parallel:
            tasks = [asyncio.create_task(_run_one(eid, i)) for i, eid in enumerate(valid_ids)]
            try:
                await asyncio.gather(*tasks)
            except JobCancelledError:
                for t in tasks:
                    if not t.done():
                        t.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                raise
        else:
            for i, eid in enumerate(valid_ids):
                await update_job_progress(job_id, i, total, f"Running evaluator {i + 1}/{total}...")
                await _run_one(eid, i)

        await update_job_progress(job_id, total, total, f"Completed: {completed} success, {errors} failed")

    except JobCancelledError:
        logger.info("Batch custom eval cancelled at %d/%d", completed, total)
        raise

    return {
        "total": total,
        "completed": completed,
        "errors": errors,
        "eval_run_ids": eval_run_ids,
    }
