"""Custom evaluator runner — executes user-defined evaluators on listings or chat sessions.

Ported from src/services/evaluators/evaluatorExecutor.ts — resolves prompt
variables, generates JSON schema, calls LLM, parses output, saves to
listing.evaluator_runs or session.evaluator_runs and the history table.

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
from app.models.history import History
from app.models.job import Job
from app.models.eval_run import ApiLog
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
    async with async_session() as db:
        db.add(ApiLog(
            run_id=log_entry.get("run_id"),
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
    """Extract scores from evaluator output for history persistence."""
    if not output:
        return None

    # Find main metric field
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

    # Build breakdown from displayable fields
    breakdown = {}
    for field in output_schema:
        if field.get("displayMode") != "hidden" and field["key"] in output:
            breakdown[field["key"]] = output[field["key"]]

    # Try to find reasoning field
    reasoning = None
    for field in output_schema:
        key_lower = field["key"].lower()
        if "reason" in key_lower or "explanation" in key_lower or "comment" in key_lower:
            reasoning = str(output.get(field["key"], ""))
            break

    # Determine max score
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


async def _save_history(
    evaluator: Evaluator,
    entity,  # Listing or ChatSession
    run: dict,
    output_schema: list[dict],
    entity_type: str = "listing",
):
    """Save evaluator run to history table."""
    duration_ms = None
    if run.get("completedAt") and run.get("startedAt"):
        # Both are ISO strings
        try:
            started = datetime.fromisoformat(run["startedAt"])
            completed = datetime.fromisoformat(run["completedAt"])
            duration_ms = (completed - started).total_seconds() * 1000
        except (ValueError, TypeError):
            pass

    status = "success" if run.get("status") == "completed" else "error"

    scores = _extract_scores(run.get("output", {}), output_schema)

    data = {
        "evaluator_name": evaluator.name,
        "evaluator_type": "llm_evaluator",
        "config_snapshot": {
            "model_id": evaluator.model_id,
            "output_schema": evaluator.output_schema,
            "prompt": evaluator.prompt,
        },
        "input_payload": run.get("rawRequest", evaluator.prompt),
        "output_payload": run.get("rawResponse") or run.get("output"),
        "scores": scores,
    }

    if run.get("error"):
        data["error_details"] = {
            "message": run["error"],
            "failed_at": run.get("completedAt"),
        }

    history_app_id = "voicerx" if entity.app_id == "voice-rx" else "kaira"

    async with async_session() as db:
        db.add(History(
            id=uuid.uuid4(),
            app_id=history_app_id,
            source_type="evaluator_run",
            entity_type=entity_type,
            entity_id=str(entity.id),
            source_id=str(evaluator.id),
            status=status,
            duration_ms=duration_ms,
            data=data,
            triggered_by="manual",
            schema_version="1.0",
            user_context=None,
            timestamp=int(datetime.now(timezone.utc).timestamp() * 1000),
        ))
        await db.commit()


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
    is_session_flow = session_id is not None

    entity_ref = session_id if is_session_flow else listing_id

    # Update progress early
    async with async_session() as db:
        await db.execute(
            update(Job).where(Job.id == job_id).values(
                progress={
                    "current": 0, "total": 2,
                    "message": "Loading evaluator...",
                    "evaluator_id": evaluator_id,
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
            # Load messages
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

    # Check if audio is needed ({{audio}} was in prompt)
    has_audio = "{{audio}}" in evaluator.prompt and audio_bytes is not None
    prompt_text = prompt_text.replace("{{audio}}", "[Audio file attached]")

    # ── Generate JSON schema from output definition ──────────────
    json_schema = generate_json_schema(evaluator.output_schema)

    # ── Resolve LLM settings ────────────────────────────────────
    from app.services.evaluators.settings_helper import get_llm_settings_from_db
    db_settings = await get_llm_settings_from_db(app_id=None, key="llm-settings")

    model = evaluator.model_id or db_settings["selected_model"]
    inner = create_llm_provider(
        provider=db_settings["provider"],
        api_key=db_settings["api_key"],
        model_name=model,
        temperature=0.2,
    )
    run_id = f"ceval-{str(entity_ref)[:8]}"
    llm: BaseLLMProvider = LoggingLLMWrapper(inner, log_callback=_save_api_log)
    llm.set_context(run_id)

    # Build run record
    now = datetime.now(timezone.utc).isoformat()
    run = {
        "id": str(uuid.uuid4()),
        "evaluatorId": str(evaluator_id),
        "status": "processing",
        "startedAt": now,
    }
    if is_session_flow:
        run["sessionId"] = str(session_id)
    else:
        run["listingId"] = str(listing_id)

    try:
        # Check cancellation
        if await is_job_cancelled(job_id):
            raise JobCancelledError("Job was cancelled by user")

        # Update progress
        async with async_session() as db:
            await db.execute(
                update(Job).where(Job.id == job_id).values(
                    progress={
                        "current": 1, "total": 2,
                        "message": "Running evaluator...",
                        "evaluator_id": evaluator_id,
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
            output = _safe_parse_json(response_text)
        else:
            output = await llm.generate_json(
                prompt=prompt_text,
                json_schema=json_schema,
            )
            response_text = json.dumps(output, ensure_ascii=False)

        if await is_job_cancelled(job_id):
            raise JobCancelledError("Job was cancelled by user")

        # ── Build completed run ──────────────────────────────────
        completed_at = datetime.now(timezone.utc).isoformat()
        run.update({
            "status": "completed",
            "output": output,
            "rawRequest": prompt_text,
            "rawResponse": response_text,
            "completedAt": completed_at,
        })

    except JobCancelledError:
        run["status"] = "failed"
        run["error"] = "Cancelled"
        run["completedAt"] = datetime.now(timezone.utc).isoformat()
        logger.info("Custom evaluator %s cancelled for %s", evaluator_id, entity_ref)

    except Exception as e:
        run["status"] = "failed"
        run["error"] = str(e)
        run["completedAt"] = datetime.now(timezone.utc).isoformat()
        logger.error("Custom evaluator %s failed for %s: %s", evaluator_id, entity_ref, e)

    # ── Append run to entity.evaluator_runs ──────────────────────
    if is_session_flow:
        async with async_session() as db:
            current_session = await db.get(ChatSession, session_id)
            if current_session:
                existing_runs = list(current_session.evaluator_runs or [])
                existing_runs.append(run)
                await db.execute(
                    update(ChatSession).where(ChatSession.id == session_id).values(
                        evaluator_runs=existing_runs,
                    )
                )
                await db.commit()
    else:
        async with async_session() as db:
            current_listing = await db.get(Listing, listing_id)
            if current_listing:
                existing_runs = list(current_listing.evaluator_runs or [])
                existing_runs.append(run)
                await db.execute(
                    update(Listing).where(Listing.id == listing_id).values(
                        evaluator_runs=existing_runs,
                    )
                )
                await db.commit()

    # ── Save to history ──────────────────────────────────────────
    entity = session if is_session_flow else listing
    try:
        await _save_history(
            evaluator, entity, run, evaluator.output_schema,
            entity_type="session" if is_session_flow else "listing",
        )
    except Exception as e:
        logger.error("Failed to save evaluator run to history: %s", e)

    # Re-raise if original call failed (so job worker marks job as failed)
    if run["status"] == "failed" and run.get("error") != "Cancelled":
        raise RuntimeError(run["error"])

    duration = time.monotonic() - start_time
    result = {
        "evaluator_id": evaluator_id,
        "run_id": run["id"],
        "status": run["status"],
        "duration_seconds": round(duration, 2),
    }
    if is_session_flow:
        result["session_id"] = session_id
    else:
        result["listing_id"] = listing_id
    return result
