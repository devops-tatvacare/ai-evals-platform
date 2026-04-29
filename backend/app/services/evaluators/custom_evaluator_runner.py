"""Custom evaluator runner — executes user-defined evaluators on listings or chat sessions.

Creates evaluation_runs rows (eval_type='custom') as the single source of truth.
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
from app.models.evaluation_dataset import EvaluationDataset
from app.models.chat import ChatSession, ChatMessage
from app.models.eval_run import EvaluationRun
from app.models.eval_template import EvaluationTemplate
from app.models.evaluator import Evaluator
from app.models.application_uploaded_file import ApplicationUploadedFile
from app.services.file_storage import file_storage
from app.services.evaluators.llm_base import (
    BaseLLMProvider, LoggingLLMWrapper, create_llm_provider,
)
from app.services.evaluators.prompt_resolver import resolve_prompt
from app.services.evaluators.schema_generator import generate_json_schema
from app.services.evaluators.response_parser import _safe_parse_json
from app.services.evaluators.output_schema_utils import (
    find_primary_field,
    build_visible_breakdown,
)
from app.services.evaluators.runner_utils import (
    save_api_log, promote_eval_run_to_running, finalize_eval_run,
    make_usage_callback,
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
    breakdown = build_visible_breakdown(output, output_schema)

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


async def run_custom_evaluator(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
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

    # Reuse the submit-time placeholder id when present so the queued row
    # already visible in the Runs list gets promoted in place.
    _placeholder_id = params.get("eval_run_id")
    eval_run_id = uuid.UUID(_placeholder_id) if _placeholder_id else uuid.uuid4()

    await promote_eval_run_to_running(
        id=eval_run_id,
        tenant_id=tenant_id,
        user_id=user_id,
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
        from types import SimpleNamespace
        from app.services.access_control import readable_scope_clause

        evaluator = await db.scalar(
            select(Evaluator).where(
                Evaluator.id == evaluator_id,
                readable_scope_clause(
                    Evaluator,
                    SimpleNamespace(tenant_id=tenant_id, user_id=user_id, app_access=frozenset()),
                ),
            )
        )
        if not evaluator:
            raise ValueError(f"Evaluator {evaluator_id} not found or not accessible")

        if is_session_flow:
            session = await db.scalar(
                select(ChatSession).where(
                    ChatSession.id == session_id,
                    ChatSession.tenant_id == tenant_id,
                    ChatSession.user_id == user_id,
                )
            )
            if not session:
                raise ValueError(f"ChatSession {session_id} not found or not accessible")
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
            listing = await db.scalar(
                select(EvaluationDataset).where(
                    EvaluationDataset.id == listing_id,
                    EvaluationDataset.tenant_id == tenant_id,
                    EvaluationDataset.user_id == user_id,
                )
            )
            if not listing:
                raise ValueError(f"Listing {listing_id} not found or not accessible")

    # ── Load audio bytes if available (voice-rx only) ────────────
    if listing:
        audio_file_meta = listing.audio_file
        if audio_file_meta and audio_file_meta.get("id"):
            async with async_session() as db:
                file_record = await db.get(ApplicationUploadedFile, audio_file_meta["id"])
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
    # ── Load prompt & schema from template if linked, else use inline ──
    if evaluator.template_id:
        template = await db.get(EvaluationTemplate, evaluator.template_id)
        if not template:
            raise RuntimeError(f"Linked template {evaluator.template_id} not found")
        raw_prompt = template.prompt
        output_schema_data = template.schema_data if isinstance(template.schema_data, list) else evaluator.output_schema
    else:
        raw_prompt = evaluator.prompt
        output_schema_data = evaluator.output_schema

    resolved = resolve_prompt(raw_prompt, resolve_ctx)
    prompt_text = resolved["prompt"]

    # Fail-fast: unresolved non-audio variables mean the listing is missing required data
    unresolved = [v for v in resolved["unresolved_variables"] if v != "{{audio}}"]
    if unresolved:
        var_names = ", ".join(unresolved)
        raise ValueError(
            f"Cannot run evaluator '{evaluator.name}': required data not available on this listing. "
            f"Unresolved variables: {var_names}"
        )

    has_audio = "{{audio}}" in raw_prompt and audio_bytes is not None
    prompt_text = prompt_text.replace("{{audio}}", "[Audio file attached]")

    # ── Generate JSON schema from output definition ──────────────
    json_schema = generate_json_schema(output_schema_data)

    # ── Resolve LLM settings ────────────────────────────────────
    from app.services.evaluators.settings_helper import get_llm_settings_from_db
    db_settings = await get_llm_settings_from_db(
        tenant_id=tenant_id, user_id=user_id,
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
    usage_cb = make_usage_callback(
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        owner_type="eval_run",
        owner_id=eval_run_id,
        default_call_purpose='custom_evaluation',
    )
    llm: BaseLLMProvider = LoggingLLMWrapper(
        inner, log_callback=save_api_log, usage_callback=usage_cb,
    )
    if params.get("timeouts"):
        llm.set_timeouts(params["timeouts"])
    llm.set_context(str(eval_run_id))

    # Store config snapshot
    config_snapshot = {
        "prompt": raw_prompt,
        "resolved_prompt": prompt_text,
        "output_schema": output_schema_data,
        "template_id": str(evaluator.template_id) if evaluator.template_id else None,
        "template_branch_key": evaluator.template_branch_key,
        "model_id": model,
        "provider": db_settings["provider"],
        "evaluator_name": evaluator.name,
        "auth_method": db_settings["auth_method"],
        "thinking": thinking,
    }

    # Update eval_run with config and LLM info
    async with async_session() as db:
        await db.execute(
            update(EvaluationRun).where(EvaluationRun.id == eval_run_id, EvaluationRun.tenant_id == tenant_id).values(
                config=config_snapshot,
                llm_provider=db_settings["provider"],
                llm_model=model,
            )
        )
        await db.commit()

    output = None
    response_text = None

    try:
        if await is_job_cancelled(job_id, tenant_id=tenant_id):
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

        if await is_job_cancelled(job_id, tenant_id=tenant_id):
            raise JobCancelledError("Job was cancelled by user")

        # ── Build completed result ──────────────────────────────
        duration_ms = (time.monotonic() - start_time) * 1000
        scores = _extract_scores(output or {}, output_schema_data)

        await finalize_eval_run(
            eval_run_id,
            tenant_id,
            status="completed",
            duration_ms=duration_ms,
            result={
                "output": output,
                "rawRequest": prompt_text,
                "rawResponse": response_text,
            },
            summary=scores,
        )

        # Submit analytics population job (fire-and-forget)
        try:
            from app.services.analytics import submit_analytics_job
            async with async_session() as db:
                await submit_analytics_job(db=db, run_id=eval_run_id, app_id=app_id, tenant_id=tenant_id, user_id=user_id)
                await db.commit()
        except Exception:
            logger.warning("Failed to submit analytics job for run %s", eval_run_id, exc_info=True)

    except JobCancelledError:
        await finalize_eval_run(
            eval_run_id,
            tenant_id,
            status="cancelled",
            duration_ms=(time.monotonic() - start_time) * 1000,
            error_message="Cancelled",
        )
        try:
            from app.services.analytics import submit_analytics_job
            async with async_session() as db:
                await submit_analytics_job(db=db, run_id=eval_run_id, app_id=app_id, tenant_id=tenant_id, user_id=user_id)
                await db.commit()
        except Exception:
            logger.warning("Failed to submit analytics job for run %s", eval_run_id, exc_info=True)
        logger.info("Custom evaluator %s cancelled for %s", evaluator_id, entity_ref)
        raise

    except Exception as e:
        error_msg = safe_error_message(e)
        await finalize_eval_run(
            eval_run_id,
            tenant_id,
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


async def run_custom_eval_batch(job_id, params: dict, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict:
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

    # Validate evaluators exist and are accessible
    async with async_session() as db:
        from types import SimpleNamespace
        from app.services.access_control import readable_scope_clause

        valid_ids = []
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
                valid_ids.append(eid)
            else:
                logger.warning("Evaluator %s not found or not accessible, skipping", eid)

        if not valid_ids:
            raise ValueError("No valid evaluators found")

    total = len(valid_ids)
    completed = 0
    errors = 0
    eval_run_ids: list[str] = []
    first_run_id_written = False

    await update_job_progress(job_id, 0, total, f"Starting {total} evaluators...")

    async def _run_one(eid: str, index: int) -> dict:
        """Run one evaluator, creating its own EvaluationRun via run_custom_evaluator."""
        nonlocal completed, errors, first_run_id_written

        if await is_job_cancelled(job_id, tenant_id=tenant_id):
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
            result = await run_custom_evaluator(job_id=job_id, params=sub_params, tenant_id=tenant_id, user_id=user_id)
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
