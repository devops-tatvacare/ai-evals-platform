"""Custom evaluator runner — executes user-defined evaluators on listings or chat sessions.

Creates eval_runs rows (eval_type='custom') as the single source of truth.
Called by the job worker when processing 'evaluate-custom' jobs.
"""
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
from app.models.evaluator import Evaluator
from app.models.file_record import FileRecord
from app.models.job import Job
from app.models.eval_run import EvalRun, ApiLog
from app.services.file_storage import file_storage
from app.services.evaluators.llm_base import (
    BaseLLMProvider, LoggingLLMWrapper, create_llm_provider,
)
from app.services.evaluators.prompt_resolver import resolve_prompt
from app.services.evaluators.schema_generator import generate_json_schema
from app.services.evaluators.response_parser import _safe_parse_json
from app.services.job_worker import is_job_cancelled, JobCancelledError

logger = logging.getLogger(__name__)


async def _save_api_log(log_entry: dict):
    """Persist an LLM API log entry to PostgreSQL."""
    run_id = log_entry.get("run_id")
    # Convert string run_id to UUID if needed
    if run_id and isinstance(run_id, str):
        try:
            run_id = uuid.UUID(run_id)
        except ValueError:
            run_id = None

    async with async_session() as db:
        db.add(ApiLog(
            run_id=run_id,
            thread_id=log_entry.get("thread_id"),
            provider=log_entry.get("provider", "unknown"),
            model=log_entry.get("model", "unknown"),
            method=log_entry.get("method", "unknown"),
            prompt=log_entry.get("prompt", ""),
            system_prompt=log_entry.get("system_prompt"),
            response=log_entry.get("response"),
            error=log_entry.get("error"),
            duration_ms=log_entry.get("duration_ms"),
            tokens_in=log_entry.get("tokens_in"),
            tokens_out=log_entry.get("tokens_out"),
        ))
        await db.commit()


def _extract_scores(output: dict, output_schema: list[dict]) -> Optional[dict]:
    """Extract scores from evaluator output for summary persistence."""
    if not output:
        return None

    main_field = next((f for f in output_schema if f.get("isMainMetric")), None)

    if not main_field:
        return {
            "overall_score": None,
            "max_score": None,
            "breakdown": output,
            "reasoning": None,
            "metadata": None,
        }

    overall_score = output.get(main_field["key"])

    breakdown = {}
    for field in output_schema:
        if field.get("displayMode") != "hidden" and field["key"] in output:
            breakdown[field["key"]] = output[field["key"]]

    reasoning = None
    for field in output_schema:
        key_lower = field["key"].lower()
        if "reason" in key_lower or "explanation" in key_lower or "comment" in key_lower:
            reasoning = str(output.get(field["key"], ""))
            break

    max_score = None
    if main_field.get("type") == "number":
        thresholds = main_field.get("thresholds")
        if thresholds:
            max_score = thresholds.get("green")
        else:
            max_score = 100

    return {
        "overall_score": overall_score if overall_score is not None else None,
        "max_score": max_score,
        "breakdown": breakdown if breakdown else None,
        "reasoning": reasoning,
        "metadata": {
            "main_metric_key": main_field["key"],
            "main_metric_type": main_field.get("type"),
            "thresholds": main_field.get("thresholds"),
        },
    }


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
    is_session_flow = session_id is not None

    entity_ref = session_id if is_session_flow else listing_id

    # Create eval_run record immediately so it's visible in UI
    eval_run_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    async with async_session() as db:
        db.add(EvalRun(
            id=eval_run_id,
            app_id=app_id,
            eval_type="custom",
            listing_id=uuid.UUID(listing_id) if listing_id and not is_session_flow else None,
            session_id=uuid.UUID(session_id) if session_id and is_session_flow else None,
            evaluator_id=uuid.UUID(str(evaluator_id)),
            job_id=job_id,
            status="running",
            started_at=now,
        ))
        await db.commit()

    # Update job progress
    async with async_session() as db:
        await db.execute(
            update(Job).where(Job.id == job_id).values(
                progress={
                    "current": 0, "total": 2,
                    "message": "Loading evaluator...",
                    "evaluator_id": str(evaluator_id),
                    "eval_run_id": str(eval_run_id),
                }
            )
        )
        await db.commit()

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

    has_audio = "{{audio}}" in evaluator.prompt and audio_bytes is not None
    prompt_text = prompt_text.replace("{{audio}}", "[Audio file attached]")

    # ── Generate JSON schema from output definition ──────────────
    json_schema = generate_json_schema(evaluator.output_schema)

    # ── Resolve LLM settings ────────────────────────────────────
    from app.services.evaluators.settings_helper import get_llm_settings_from_db
    db_settings = await get_llm_settings_from_db(app_id=None, key="llm-settings", auth_intent="managed_job")

    model = evaluator.model_id or db_settings["selected_model"]
    inner = create_llm_provider(
        provider=db_settings["provider"],
        api_key=db_settings["api_key"],
        model_name=model,
        temperature=0.2,
        service_account_path=db_settings.get("service_account_path", ""),
    )
    llm: BaseLLMProvider = LoggingLLMWrapper(inner, log_callback=_save_api_log)
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
        async with async_session() as db:
            await db.execute(
                update(Job).where(Job.id == job_id).values(
                    progress={
                        "current": 1, "total": 2,
                        "message": "Running evaluator...",
                        "evaluator_id": str(evaluator_id),
                        "eval_run_id": str(eval_run_id),
                    }
                )
            )
            await db.commit()

        # ── Call LLM ─────────────────────────────────────────────
        if has_audio and audio_bytes:
            response_text = await llm.generate_with_audio(
                prompt=prompt_text,
                audio_bytes=audio_bytes,
                mime_type=mime_type,
                json_schema=json_schema,
            )
            output, _was_repaired = _safe_parse_json(response_text)
        else:
            output = await llm.generate_json(
                prompt=prompt_text,
                json_schema=json_schema,
            )
            response_text = json.dumps(output, ensure_ascii=False)

        if await is_job_cancelled(job_id):
            raise JobCancelledError("Job was cancelled by user")

        # ── Build completed result ──────────────────────────────
        completed_at = datetime.now(timezone.utc)
        duration_ms = (time.monotonic() - start_time) * 1000
        scores = _extract_scores(output or {}, evaluator.output_schema)

        result_data = {
            "output": output,
            "rawRequest": prompt_text,
            "rawResponse": response_text,
        }

        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(EvalRun.id == eval_run_id).values(
                    status="completed",
                    completed_at=completed_at,
                    duration_ms=duration_ms,
                    result=result_data,
                    summary=scores,
                )
            )
            await db.commit()

    except JobCancelledError:
        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(EvalRun.id == eval_run_id).values(
                    status="cancelled",
                    completed_at=datetime.now(timezone.utc),
                    duration_ms=(time.monotonic() - start_time) * 1000,
                    error_message="Cancelled",
                )
            )
            await db.commit()
        logger.info("Custom evaluator %s cancelled for %s", evaluator_id, entity_ref)

    except Exception as e:
        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(EvalRun.id == eval_run_id).values(
                    status="failed",
                    completed_at=datetime.now(timezone.utc),
                    duration_ms=(time.monotonic() - start_time) * 1000,
                    error_message=str(e),
                    result={"rawRequest": prompt_text} if prompt_text else None,
                )
            )
            await db.commit()
        logger.error("Custom evaluator %s failed for %s: %s", evaluator_id, entity_ref, e)
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
