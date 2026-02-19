"""Voice-RX evaluation runner — two-call pipeline (transcription + critique).

Creates eval_runs rows (eval_type='full_evaluation') as the single source of truth.
Called by the job worker when processing 'evaluate-voice-rx' jobs.
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
from app.models.file_record import FileRecord
from app.models.job import Job
from app.models.eval_run import EvalRun, ApiLog
from app.services.file_storage import file_storage
from app.services.evaluators.llm_base import (
    BaseLLMProvider, LoggingLLMWrapper, create_llm_provider,
)
from app.services.evaluators.response_parser import (
    parse_transcript_response,
    parse_critique_response,
    parse_api_critique_response,
    _safe_parse_json,
)
from app.services.evaluators.prompt_resolver import resolve_prompt
from app.services.evaluators.flow_config import FlowConfig
from app.services.job_worker import is_job_cancelled, JobCancelledError, safe_error_message

logger = logging.getLogger(__name__)


# ── Normalization prompt (ported from normalizationService.ts) ───

NORMALIZATION_PROMPT = """You are an expert multilingual transliteration specialist.

TASK: Convert the following transcript from {source_script} script to {target_script} script.
Source language: {language}

RULES:
1. Transliterate all text from {source_script} to {target_script} using standard conventions for {language}
2. Preserve proper nouns, technical/medical terminology, and widely-known abbreviations in their original form
3. Keep speaker labels unchanged
4. Keep timestamps unchanged (startTime, endTime, startSeconds, endSeconds)
5. For code-switched content (multiple languages mixed), transliterate the {language} portions while keeping other language portions intact
6. Return EXACT same JSON structure with same number of segments
7. If source and target scripts are the same, return the transcript unchanged

INPUT TRANSCRIPT:
{transcript_json}

OUTPUT: Return the transliterated transcript in JSON format with the same structure."""

NORMALIZATION_SCHEMA = {
    "type": "object",
    "properties": {
        "segments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "speaker": {"type": "string"},
                    "text": {"type": "string"},
                    "startTime": {"type": "string", "description": "Exact start time in HH:MM:SS format — must match the original transcript time window exactly, do not modify or approximate"},
                    "endTime": {"type": "string", "description": "Exact end time in HH:MM:SS format — must match the original transcript time window exactly, do not modify or approximate"},
                },
                "required": ["speaker", "text", "startTime", "endTime"],
            },
        },
    },
    "required": ["segments"],
}

NORMALIZATION_PROMPT_PLAIN = """You are an expert multilingual transliteration specialist.

TASK: Convert the following transcript text from {source_script} script to {target_script} script.
Source language: {language}

RULES:
1. Transliterate all text from {source_script} to {target_script} using standard conventions for {language}
2. Preserve proper nouns, technical/medical terminology, and widely-known abbreviations in their original form
3. Keep speaker labels (e.g., [Doctor]:, [Patient]:) unchanged
4. For code-switched content (multiple languages mixed), transliterate the {language} portions while keeping other language portions intact
5. If source and target scripts are the same, return the text unchanged
6. Preserve line breaks and formatting

INPUT TRANSCRIPT:
{transcript_text}

OUTPUT: Return the transliterated transcript text."""

NORMALIZATION_SCHEMA_PLAIN = {
    "type": "object",
    "properties": {
        "normalized_text": {
            "type": "string",
            "description": "The full transcript text transliterated to the target script"
        },
    },
    "required": ["normalized_text"],
}


async def _save_api_log(log_entry: dict):
    """Persist an LLM API log entry to PostgreSQL."""
    run_id = log_entry.get("run_id")
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


async def _update_progress(job_id, current: int, total: int, message: str, listing_id: str = "", run_id: str = ""):
    """Update job progress with listing_id and run_id for frontend tracking."""
    progress = {
        "current": current,
        "total": total,
        "message": message,
    }
    if listing_id:
        progress["listing_id"] = listing_id
    if run_id:
        progress["run_id"] = run_id
    async with async_session() as db:
        await db.execute(
            update(Job).where(Job.id == job_id).values(progress=progress)
        )
        await db.commit()


async def run_voice_rx_evaluation(job_id, params: dict) -> dict:
    """Run voice-rx two-call evaluation pipeline.

    Params (from frontend job submission):
        listing_id: str              - UUID of listing
        app_id: str                  - "voice-rx"
        transcription_prompt: str    - resolved transcription prompt text
        evaluation_prompt: str       - resolved evaluation prompt text
        transcription_schema: dict   - JSON schema for transcription output (optional)
        evaluation_schema: dict      - JSON schema for evaluation output (optional)
        skip_transcription: bool     - skip Call 1, reuse existing AI transcript
        normalize_original: bool     - normalize original transcript before critique
        prerequisites: dict          - language, targetScript, sourceScript, etc.
        transcription_model: str     - model override for Call 1
        evaluation_model: str        - model override for Call 2
    """
    start_time = time.monotonic()
    listing_id = params["listing_id"]
    app_id = params.get("app_id", "voice-rx")

    # Create eval_run record immediately
    eval_run_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    async with async_session() as db:
        db.add(EvalRun(
            id=eval_run_id,
            app_id=app_id,
            eval_type="full_evaluation",
            listing_id=uuid.UUID(listing_id) if isinstance(listing_id, str) else listing_id,
            job_id=job_id,
            status="running",
            started_at=now,
        ))
        await db.commit()

    await _update_progress(job_id, 0, 3, "Initializing...", listing_id, str(eval_run_id))

    # ── Load listing ─────────────────────────────────────────────
    async with async_session() as db:
        listing = await db.get(Listing, listing_id)
        if not listing:
            raise ValueError(f"Listing {listing_id} not found")

    audio_file_meta = listing.audio_file
    if not audio_file_meta:
        raise ValueError(f"Listing {listing_id} has no audio file")

    file_id = audio_file_meta.get("id")
    async with async_session() as db:
        file_record = await db.get(FileRecord, file_id)
        if not file_record:
            raise ValueError(f"File record {file_id} not found")

    audio_bytes = await file_storage.read(file_record.storage_path)
    mime_type = file_record.mime_type or audio_file_meta.get("mimeType", "audio/mpeg")

    # ── Resolve LLM settings ────────────────────────────────────
    from app.services.evaluators.settings_helper import get_llm_settings_from_db
    db_settings = await get_llm_settings_from_db(app_id=None, key="llm-settings", auth_intent="managed_job")
    api_key = db_settings["api_key"]
    provider = db_settings["provider"]
    service_account_path = db_settings.get("service_account_path", "")

    transcription_model = params.get("transcription_model") or db_settings["selected_model"]
    evaluation_model = params.get("evaluation_model") or db_settings["selected_model"]

    # ── Create LLM providers ────────────────────────────────────
    def _create_llm(model: str) -> BaseLLMProvider:
        inner = create_llm_provider(
            provider=provider, api_key=api_key,
            model_name=model, temperature=0.3,
            service_account_path=service_account_path,
        )
        llm = LoggingLLMWrapper(inner, log_callback=_save_api_log)
        if params.get("timeouts"):
            llm.set_timeouts(params["timeouts"])
        llm.set_context(str(eval_run_id))
        return llm

    # ── Extract params ───────────────────────────────────────────
    transcription_prompt = params.get("transcription_prompt", "")
    evaluation_prompt = params.get("evaluation_prompt", "")
    transcription_schema = params.get("transcription_schema")
    evaluation_schema = params.get("evaluation_schema")
    skip_transcription = params.get("skip_transcription", False)
    normalize_original = params.get("normalize_original", False)
    use_segments = params.get("use_segments", True)
    prerequisites = params.get("prerequisites", {})

    source_type = listing.source_type or "upload"
    is_api_flow = source_type == "api"

    # Store config snapshot
    config_snapshot = {
        "prompts": {
            "transcription": transcription_prompt,
            "evaluation": evaluation_prompt,
        },
        "schemas": {
            "transcription": transcription_schema,
            "evaluation": evaluation_schema,
        },
        "models": {
            "transcription": transcription_model,
            "evaluation": evaluation_model,
        },
        "prerequisites": prerequisites,
        "skip_transcription": skip_transcription,
        "normalize_original": normalize_original,
        "source_type": source_type,
        "auth_method": db_settings["auth_method"],
    }

    # Update eval_run with config and LLM info
    async with async_session() as db:
        await db.execute(
            update(EvalRun).where(EvalRun.id == eval_run_id).values(
                config=config_snapshot,
                llm_provider=provider,
                llm_model=transcription_model,
            )
        )
        await db.commit()

    # Determine step count
    total_steps = 0
    if not skip_transcription:
        total_steps += 1
    if normalize_original and not is_api_flow:
        total_steps += 1
    total_steps += 1  # critique always runs

    # Build the evaluation result (camelCase keys for frontend compat)
    evaluation = {
        "id": str(eval_run_id),
        "createdAt": now.isoformat(),
        "model": transcription_model,
        "models": {"transcription": transcription_model, "evaluation": evaluation_model},
        "status": "processing",
        "prompts": {
            "transcription": transcription_prompt,
            "evaluation": evaluation_prompt,
        },
    }

    current_step = 0

    try:
        async def check_cancel():
            if await is_job_cancelled(job_id):
                raise JobCancelledError("Job was cancelled by user")

        if is_api_flow:
            # ══════════════════════════════════════════════════════
            # API FLOW
            # ══════════════════════════════════════════════════════
            llm_transcription = _create_llm(transcription_model)
            llm_evaluation = _create_llm(evaluation_model)

            current_step += 1
            await _update_progress(job_id, current_step, total_steps, "Judge is transcribing audio...", listing_id, str(eval_run_id))
            await check_cancel()

            api_schema = transcription_schema
            if not api_schema:
                raise ValueError("No API response schema configured for transcription.")

            resolve_ctx = {
                "listing": {
                    "transcript": listing.transcript,
                    "sourceType": source_type,
                    "apiResponse": listing.api_response,
                },
                "prerequisites": prerequisites,
                "use_segments": False,
            }
            resolved = resolve_prompt(transcription_prompt, resolve_ctx)
            transcription_prompt_text = resolved["prompt"]
            transcription_prompt_text = transcription_prompt_text.replace("{{audio}}", "[Audio file attached]")

            response_text = await llm_transcription.generate_with_audio(
                prompt=transcription_prompt_text,
                audio_bytes=audio_bytes,
                mime_type=mime_type,
                json_schema=api_schema,
            )
            await check_cancel()

            parsed, was_repaired = _safe_parse_json(response_text)
            if was_repaired:
                evaluation.setdefault("warnings", []).append(
                    "Transcription response was truncated and auto-repaired"
                )

            if "input" in parsed:
                judge_transcript = str(parsed["input"])
            elif "segments" in parsed:
                judge_transcript = "\n".join(
                    f"[{s.get('speaker', 'Unknown')}]: {s.get('text', '')}"
                    for s in parsed["segments"]
                )
            else:
                judge_transcript = json.dumps(parsed, ensure_ascii=False)

            judge_structured = parsed.get("rx", parsed)

            evaluation["judgeOutput"] = {
                "transcript": judge_transcript,
                "structuredData": judge_structured,
            }

            current_step += 1
            await _update_progress(job_id, current_step, total_steps, "Comparing outputs...", listing_id, str(eval_run_id))
            await check_cancel()

            api_response = listing.api_response or {}
            api_output_text = (
                f"\n\n=== API OUTPUT ===\n"
                f"Transcript: {api_response.get('input', '')}\n\n"
                f"Structured Data:\n{json.dumps(api_response.get('rx', {}), indent=2)}"
            )
            judge_output_text = (
                f"\n\n=== JUDGE OUTPUT ===\n"
                f"Transcript: {judge_transcript}\n\n"
                f"Structured Data:\n{json.dumps(judge_structured, indent=2)}"
            )

            eval_resolve_ctx = {
                "listing": {
                    "transcript": listing.transcript,
                    "sourceType": source_type,
                    "apiResponse": listing.api_response,
                },
                "ai_eval": {
                    "judgeOutput": {
                        "structuredData": judge_structured,
                    },
                },
                "prerequisites": prerequisites,
                "use_segments": False,
            }
            eval_resolved = resolve_prompt(evaluation_prompt, eval_resolve_ctx)
            eval_prompt_text = eval_resolved["prompt"]
            eval_prompt_text = eval_prompt_text.replace("{{audio}}", "[Audio file attached]")
            full_prompt = f"{eval_prompt_text}{api_output_text}{judge_output_text}"

            critique_text = await llm_evaluation.generate_with_audio(
                prompt=full_prompt,
                audio_bytes=audio_bytes,
                mime_type=mime_type,
                json_schema=evaluation_schema,
            )
            await check_cancel()

            evaluation["apiCritique"] = parse_api_critique_response(critique_text, evaluation_model)
            evaluation["status"] = "completed"

        else:
            # ══════════════════════════════════════════════════════
            # UPLOAD FLOW
            # ══════════════════════════════════════════════════════
            llm_transcript_data = None
            original_for_critique = listing.transcript

            if skip_transcription:
                # Reuse existing AI transcript from previous eval_run
                existing_eval = None
                async with async_session() as db:
                    prev_run_result = await db.execute(
                        select(EvalRun)
                        .where(
                            EvalRun.listing_id == uuid.UUID(listing_id) if isinstance(listing_id, str) else listing_id,
                            EvalRun.eval_type == "full_evaluation",
                            EvalRun.status == "completed",
                        )
                        .order_by(EvalRun.created_at.desc())
                        .limit(1)
                    )
                    prev_run = prev_run_result.scalar_one_or_none()
                    if prev_run and prev_run.result:
                        existing_eval = prev_run.result

                if not existing_eval:
                    raise ValueError("Cannot skip transcription: no existing AI transcript available.")
                llm_transcript_data = existing_eval.get("llmTranscript")
                if not llm_transcript_data:
                    raise ValueError("Cannot skip transcription: no existing AI transcript available.")
                evaluation["llmTranscript"] = llm_transcript_data
                if existing_eval.get("prompts", {}).get("transcription"):
                    evaluation["prompts"]["transcription"] = existing_eval["prompts"]["transcription"]
            else:
                current_step += 1
                await _update_progress(job_id, current_step, total_steps, "Transcribing audio...", listing_id, str(eval_run_id))
                await check_cancel()

                llm_transcription = _create_llm(transcription_model)

                resolve_ctx = {
                    "listing": {
                        "transcript": listing.transcript,
                        "sourceType": source_type,
                        "apiResponse": listing.api_response,
                    },
                    "prerequisites": prerequisites,
                    "use_segments": use_segments,
                }
                resolved = resolve_prompt(transcription_prompt, resolve_ctx)
                prompt_text = resolved["prompt"]
                prompt_text = prompt_text.replace("{{audio}}", "[Audio file attached]")

                response_text = await llm_transcription.generate_with_audio(
                    prompt=prompt_text,
                    audio_bytes=audio_bytes,
                    mime_type=mime_type,
                    json_schema=transcription_schema,
                )
                await check_cancel()

                llm_transcript_data = parse_transcript_response(response_text)
                evaluation["llmTranscript"] = llm_transcript_data

            # Normalization step (optional)
            if normalize_original and original_for_critique:
                current_step += 1
                await _update_progress(job_id, current_step, total_steps, "Normalizing transcript...", listing_id, str(eval_run_id))
                await check_cancel()

                target_script = prerequisites.get("targetScript", prerequisites.get("target_script", "Roman"))
                source_script = prerequisites.get("sourceScript", prerequisites.get("source_script", "Devanagari"))

                norm_prompt = NORMALIZATION_PROMPT.format(
                    source_script=source_script,
                    target_script=target_script,
                    language=prerequisites.get("language", "the source language"),
                    transcript_json=json.dumps(original_for_critique, indent=2),
                )

                norm_model = prerequisites.get("normalizationModel") or prerequisites.get("normalization_model") or transcription_model
                llm_norm = _create_llm(norm_model)

                norm_text = await llm_norm.generate_json(
                    prompt=norm_prompt,
                    json_schema=NORMALIZATION_SCHEMA,
                )
                await check_cancel()

                norm_segments = norm_text.get("segments", [])
                if norm_segments:
                    orig_segments = original_for_critique.get("segments", [])
                    normalized_segments = []
                    for idx, seg in enumerate(norm_segments):
                        normalized_segments.append({
                            "speaker": seg.get("speaker", "Unknown"),
                            "text": seg.get("text", ""),
                            "startTime": seg.get("startTime", "00:00:00"),
                            "endTime": seg.get("endTime", "00:00:00"),
                            "startSeconds": orig_segments[idx].get("startSeconds") if idx < len(orig_segments) else None,
                            "endSeconds": orig_segments[idx].get("endSeconds") if idx < len(orig_segments) else None,
                        })
                    full_transcript = "\n".join(
                        f"[{s['speaker']}]: {s['text']}" for s in normalized_segments
                    )
                    original_for_critique = {
                        **original_for_critique,
                        "segments": normalized_segments,
                        "fullTranscript": full_transcript,
                        "generatedAt": datetime.now(timezone.utc).isoformat(),
                    }
                    evaluation["normalizedOriginal"] = original_for_critique
                    evaluation["normalizationMeta"] = {
                        "enabled": True,
                        "sourceScript": source_script,
                        "targetScript": target_script,
                        "normalizedAt": datetime.now(timezone.utc).isoformat(),
                    }

            # Call 2: Critique (always runs)
            if not llm_transcript_data:
                raise ValueError("No valid transcription data for critique step")

            current_step += 1
            await _update_progress(job_id, current_step, total_steps, "Generating critique...", listing_id, str(eval_run_id))
            await check_cancel()

            llm_evaluation = _create_llm(evaluation_model)

            resolve_ctx = {
                "listing": {
                    "transcript": original_for_critique,
                    "sourceType": source_type,
                    "apiResponse": listing.api_response,
                },
                "ai_eval": {
                    "llmTranscript": llm_transcript_data,
                },
                "prerequisites": prerequisites,
                "use_segments": use_segments,
            }
            resolved = resolve_prompt(evaluation_prompt, resolve_ctx)
            eval_prompt_text = resolved["prompt"]
            eval_prompt_text = eval_prompt_text.replace("{{audio}}", "[Audio file attached]")

            critique_text = await llm_evaluation.generate_with_audio(
                prompt=eval_prompt_text,
                audio_bytes=audio_bytes,
                mime_type=mime_type,
                json_schema=evaluation_schema,
            )
            await check_cancel()

            original_segments = (original_for_critique or {}).get("segments", [])
            llm_segments = llm_transcript_data.get("segments", [])

            critique = parse_critique_response(
                critique_text, original_segments, llm_segments, evaluation_model,
            )
            evaluation["critique"] = critique
            evaluation["status"] = "completed"

        # ── Build summary from evaluation result ────────────────────
        summary_data = None
        if evaluation.get("status") == "completed":
            summary_data = {}

            if is_api_flow and evaluation.get("apiCritique"):
                critique = evaluation["apiCritique"]
                if isinstance(critique, dict):
                    for score_key in ["overall_score", "accuracy_score", "factual_integrity_score"]:
                        if score_key in critique:
                            summary_data[score_key] = critique[score_key]
                    if critique.get("segments"):
                        total_segs = len(critique["segments"])
                        matches = sum(1 for s in critique["segments"]
                                      if s.get("accuracy", "").lower() in ("match", "none"))
                        summary_data["overall_accuracy"] = matches / total_segs if total_segs > 0 else 0
                        summary_data["total_segments"] = total_segs
                        severity_dist = {}
                        for s in critique["segments"]:
                            sev = s.get("severity", "none").upper()
                            severity_dist[sev] = severity_dist.get(sev, 0) + 1
                        summary_data["severity_distribution"] = severity_dist

            elif evaluation.get("critique"):
                critique = evaluation["critique"]
                if isinstance(critique, dict):
                    segments = critique.get("segments", [])
                    total_segs = len(segments)
                    if total_segs > 0:
                        matches = sum(1 for s in segments
                                      if s.get("accuracy", "").lower() in ("match", "none"))
                        summary_data["overall_accuracy"] = matches / total_segs
                        summary_data["total_segments"] = total_segs

                        severity_dist = {}
                        for s in segments:
                            sev = s.get("severity", "none").upper()
                            severity_dist[sev] = severity_dist.get(sev, 0) + 1
                        summary_data["severity_distribution"] = severity_dist
                        summary_data["critical_errors"] = severity_dist.get("CRITICAL", 0)
                        summary_data["moderate_errors"] = severity_dist.get("MODERATE", 0)
                        summary_data["minor_errors"] = severity_dist.get("MINOR", 0)

                    if critique.get("overallScore") is not None:
                        summary_data["overall_score"] = critique["overallScore"]

        # ── Save result to eval_runs ───────────────────────────────
        completed_at = datetime.now(timezone.utc)
        duration_ms = (time.monotonic() - start_time) * 1000

        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(EvalRun.id == eval_run_id).values(
                    status="completed",
                    completed_at=completed_at,
                    duration_ms=duration_ms,
                    result=evaluation,
                    summary=summary_data,
                )
            )
            await db.commit()

        duration = time.monotonic() - start_time
        return {
            "listing_id": listing_id,
            "eval_run_id": str(eval_run_id),
            "status": "completed",
            "duration_seconds": round(duration, 2),
        }

    except JobCancelledError:
        evaluation["status"] = "cancelled"
        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(EvalRun.id == eval_run_id).values(
                    status="cancelled",
                    completed_at=datetime.now(timezone.utc),
                    duration_ms=(time.monotonic() - start_time) * 1000,
                    result=evaluation,
                )
            )
            await db.commit()
        logger.info("Voice-RX evaluation for %s cancelled", listing_id)
        return {"listing_id": listing_id, "eval_run_id": str(eval_run_id), "status": "cancelled"}

    except Exception as e:
        error_msg = safe_error_message(e)
        evaluation["status"] = "failed"
        evaluation["error"] = error_msg
        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(
                    EvalRun.id == eval_run_id,
                    EvalRun.status != "cancelled",
                ).values(
                    status="failed",
                    completed_at=datetime.now(timezone.utc),
                    duration_ms=(time.monotonic() - start_time) * 1000,
                    error_message=error_msg,
                    result=evaluation,
                )
            )
            await db.commit()
        raise


# ═══════════════════════════════════════════════════════════════════
# Step functions (FlowConfig-driven pipeline)
# ═══════════════════════════════════════════════════════════════════


async def _run_transcription(
    flow: FlowConfig, llm, listing, audio_bytes, mime_type,
    prompt_text, schema, prerequisites,
) -> dict:
    """Step 1: Transcription.

    Upload flow: Transcribe audio -> segments with time alignment.
    API flow: Judge transcribes audio -> flat transcript + structured data.

    Returns dict to merge into evaluation:
      Upload: { "judgeOutput": { "transcript": str, "segments": [...] } }
      API:    { "judgeOutput": { "transcript": str, "structuredData": {...} } }
    """
    resolve_ctx = {
        "listing": {
            "transcript": listing.transcript,
            "sourceType": flow.flow_type,
            "apiResponse": listing.api_response,
        },
        "prerequisites": prerequisites,
        "use_segments": flow.use_segments_in_prompts,
    }
    resolved = resolve_prompt(prompt_text, resolve_ctx)
    final_prompt = resolved["prompt"].replace("{{audio}}", "[Audio file attached]")

    if not schema:
        raise ValueError(f"No transcription schema configured for {flow.flow_type} flow.")

    response_text = await llm.generate_with_audio(
        prompt=final_prompt,
        audio_bytes=audio_bytes,
        mime_type=mime_type,
        json_schema=schema,
    )

    if flow.requires_segments:
        # Upload flow: parse into segments structure
        transcript_data = parse_transcript_response(response_text)
        return {
            "judgeOutput": {
                "transcript": transcript_data.get("fullTranscript", ""),
                "segments": transcript_data.get("segments", []),
            },
        }
    else:
        # API flow: parse into transcript + structured data
        parsed, was_repaired = _safe_parse_json(response_text)
        warnings = []
        if was_repaired:
            warnings.append("Transcription response was truncated and auto-repaired")

        # Extract transcript text
        if "input" in parsed:
            judge_transcript = str(parsed["input"])
        elif "segments" in parsed:
            judge_transcript = "\n".join(
                f"[{s.get('speaker', 'Unknown')}]: {s.get('text', '')}"
                for s in parsed["segments"]
            )
        else:
            judge_transcript = json.dumps(parsed, ensure_ascii=False)

        judge_structured = parsed.get("rx", parsed)

        result = {
            "judgeOutput": {
                "transcript": judge_transcript,
                "structuredData": judge_structured,
            },
        }
        if warnings:
            result["warnings"] = warnings
        return result


async def _reuse_previous_transcript(listing_id: str, flow: FlowConfig) -> dict:
    """Skip transcription: reuse judgeOutput from the most recent completed eval_run.

    Works for both flows — reads `judgeOutput` from the prior run's unified result.
    Returns same shape as _run_transcription() so the caller doesn't care.

    Upload flow prior result has: judgeOutput.transcript + judgeOutput.segments
    API flow prior result has:    judgeOutput.transcript + judgeOutput.structuredData
    """
    async with async_session() as db:
        prev_run_result = await db.execute(
            select(EvalRun)
            .where(
                EvalRun.listing_id == (uuid.UUID(listing_id) if isinstance(listing_id, str) else listing_id),
                EvalRun.eval_type == "full_evaluation",
                EvalRun.status == "completed",
            )
            .order_by(EvalRun.created_at.desc())
            .limit(1)
        )
        prev_run = prev_run_result.scalar_one_or_none()

    if not prev_run or not prev_run.result:
        raise ValueError("Cannot skip transcription: no previous completed eval_run found.")

    prev_result = prev_run.result
    judge_output = prev_result.get("judgeOutput")

    if not judge_output:
        raise ValueError("Cannot skip transcription: previous eval_run has no judgeOutput.")

    result = {"judgeOutput": judge_output}

    # Carry forward the transcription prompt used in the prior run
    prev_prompts = prev_result.get("prompts", {})
    if prev_prompts.get("transcription"):
        result["_reused_transcription_prompt"] = prev_prompts["transcription"]

    return result


async def _run_normalization(
    flow: FlowConfig, llm, listing, prerequisites,
) -> dict:
    """Step 2: Normalization (optional).

    Transliterates source transcript from one script to another.
    Handles both input formats based on what the listing has:
      - dict with 'segments' -> segment-level normalization (upload flow)
      - str -> plain text normalization (API flow)

    Returns dict to merge into evaluation:
      { "normalizedOriginal": { "fullTranscript": str, "segments"?: [...] },
        "normalizationMeta": { "enabled": true, ... } }
    """
    target_script = prerequisites.get("targetScript",
                    prerequisites.get("target_script", "Roman"))
    source_script = prerequisites.get("sourceScript",
                    prerequisites.get("source_script", "Devanagari"))
    language = prerequisites.get("language", "the source language")

    # Determine input based on what the listing actually has (not flow flag)
    source_input = _get_normalization_source(listing, flow)

    if source_input is None:
        # Nothing to normalize — skip silently
        return {}

    normalized_data = await _normalize_transcript(
        llm=llm,
        transcript_input=source_input,
        source_script=source_script,
        target_script=target_script,
        language=language,
    )

    if not normalized_data:
        return {}

    return {
        "normalizedOriginal": normalized_data,
        "normalizationMeta": {
            "enabled": True,
            "sourceScript": source_script,
            "targetScript": target_script,
            "normalizedAt": datetime.now(timezone.utc).isoformat(),
        },
    }


def _get_normalization_source(listing, flow: FlowConfig):
    """Get the transcript to normalize from the listing.
    Inspects actual data, not just flow type.
    """
    if listing.transcript and isinstance(listing.transcript, dict):
        segments = listing.transcript.get("segments")
        if segments and len(segments) > 0:
            return listing.transcript  # dict with segments
        full = listing.transcript.get("fullTranscript")
        if full:
            return full  # plain text from transcript dict

    if listing.api_response and isinstance(listing.api_response, dict):
        input_text = listing.api_response.get("input")
        if input_text and isinstance(input_text, str) and len(input_text.strip()) > 0:
            return input_text  # plain string from API

    return None


async def _normalize_transcript(llm, transcript_input, source_script, target_script, language) -> dict | None:
    """Core normalization function. Accepts any format, returns consistent shape.

    Input: str or dict-with-segments
    Output: { "fullTranscript": str, "segments"?: [...] } or None
    """
    has_segments = (isinstance(transcript_input, dict)
                    and isinstance(transcript_input.get("segments"), list)
                    and len(transcript_input["segments"]) > 0)

    if has_segments:
        # ── Segment-level normalization ──
        prompt = NORMALIZATION_PROMPT.format(
            source_script=source_script,
            target_script=target_script,
            language=language,
            transcript_json=json.dumps(transcript_input, indent=2),
        )
        result = await llm.generate_json(prompt=prompt, json_schema=NORMALIZATION_SCHEMA)

        norm_segments = result.get("segments", [])
        if not norm_segments:
            return None

        orig_segments = transcript_input.get("segments", [])
        normalized_segments = []
        for idx, seg in enumerate(norm_segments):
            normalized_segments.append({
                "speaker": seg.get("speaker", "Unknown"),
                "text": seg.get("text", ""),
                "startTime": seg.get("startTime", "00:00:00"),
                "endTime": seg.get("endTime", "00:00:00"),
                "startSeconds": orig_segments[idx].get("startSeconds") if idx < len(orig_segments) else None,
                "endSeconds": orig_segments[idx].get("endSeconds") if idx < len(orig_segments) else None,
            })

        full_transcript = "\n".join(
            f"[{s['speaker']}]: {s['text']}" for s in normalized_segments
        )
        return {
            "fullTranscript": full_transcript,
            "segments": normalized_segments,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }
    else:
        # ── Plain text normalization ──
        text = transcript_input if isinstance(transcript_input, str) else str(transcript_input)
        prompt = NORMALIZATION_PROMPT_PLAIN.format(
            source_script=source_script,
            target_script=target_script,
            language=language,
            transcript_text=text,
        )
        result = await llm.generate_json(prompt=prompt, json_schema=NORMALIZATION_SCHEMA_PLAIN)

        normalized_text = result.get("normalized_text", "").strip()
        if not normalized_text:
            return None

        return {
            "fullTranscript": normalized_text,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }


async def _run_critique(
    flow: FlowConfig, llm, listing, audio_bytes, mime_type,
    prompt_text, schema, prerequisites, evaluation,
) -> dict:
    """Step 3: Critique/comparison.

    Upload flow: Segment-level comparison (original vs judge).
    API flow: Field-level comparison (API output vs judge output).

    Returns dict to merge into evaluation:
      { "critique": { unified shape } }
    """
    judge_output = evaluation.get("judgeOutput", {})
    normalized = evaluation.get("normalizedOriginal")

    if flow.requires_segments:
        # ── Upload flow critique ──
        # Use normalized transcript if available, else original
        original_transcript = listing.transcript
        if normalized and "segments" in normalized:
            original_transcript = {**listing.transcript, **normalized}

        resolve_ctx = {
            "listing": {
                "transcript": original_transcript,
                "sourceType": flow.flow_type,
                "apiResponse": listing.api_response,
            },
            "ai_eval": {
                "llmTranscript": {
                    "fullTranscript": judge_output.get("transcript", ""),
                    "segments": judge_output.get("segments", []),
                },
            },
            "prerequisites": prerequisites,
            "use_segments": True,
        }
        resolved = resolve_prompt(prompt_text, resolve_ctx)
        final_prompt = resolved["prompt"].replace("{{audio}}", "[Audio file attached]")

        critique_text = await llm.generate_with_audio(
            prompt=final_prompt,
            audio_bytes=audio_bytes,
            mime_type=mime_type,
            json_schema=schema,
        )

        original_segments = (original_transcript or {}).get("segments", [])
        llm_segments = judge_output.get("segments", [])

        raw_critique = parse_critique_response(
            critique_text, original_segments, llm_segments, llm.model_name,
        )

        # Normalize to unified shape
        return {
            "critique": {
                "flowType": "upload",
                "overallAssessment": raw_critique.get("overallAssessment", ""),
                "statistics": raw_critique.get("statistics", {}),
                "segments": raw_critique.get("segments", []),
                "assessmentReferences": raw_critique.get("assessmentReferences", []),
                "rawOutput": raw_critique,
                "generatedAt": raw_critique.get("generatedAt", ""),
                "model": raw_critique.get("model", ""),
            },
        }
    else:
        # ── API flow critique ──
        api_response = listing.api_response or {}
        judge_transcript = judge_output.get("transcript", "")
        judge_structured = judge_output.get("structuredData", {})

        api_output_text = (
            f"\n\n=== API OUTPUT ===\n"
            f"Transcript: {api_response.get('input', '')}\n\n"
            f"Structured Data:\n{json.dumps(api_response.get('rx', {}), indent=2)}"
        )
        judge_output_text = (
            f"\n\n=== JUDGE OUTPUT ===\n"
            f"Transcript: {judge_transcript}\n\n"
            f"Structured Data:\n{json.dumps(judge_structured, indent=2)}"
        )

        resolve_ctx = {
            "listing": {
                "transcript": listing.transcript,
                "sourceType": flow.flow_type,
                "apiResponse": listing.api_response,
            },
            "ai_eval": {
                "judgeOutput": {"structuredData": judge_structured},
            },
            "prerequisites": prerequisites,
            "use_segments": False,
        }
        resolved = resolve_prompt(prompt_text, resolve_ctx)
        final_prompt = resolved["prompt"].replace("{{audio}}", "[Audio file attached]")
        full_prompt = f"{final_prompt}{api_output_text}{judge_output_text}"

        critique_text = await llm.generate_with_audio(
            prompt=full_prompt,
            audio_bytes=audio_bytes,
            mime_type=mime_type,
            json_schema=schema,
        )

        raw_critique = parse_api_critique_response(critique_text, llm.model_name)

        # Normalize to unified shape
        return {
            "critique": {
                "flowType": "api",
                "overallAssessment": raw_critique.get("overallAssessment", ""),
                "transcriptComparison": raw_critique.get("transcriptComparison"),
                "fieldCritiques": _extract_field_critiques_from_raw(raw_critique),
                "rawOutput": raw_critique.get("rawOutput", raw_critique),
                "generatedAt": raw_critique.get("generatedAt", ""),
                "model": raw_critique.get("model", ""),
            },
        }


def _build_summary(flow: FlowConfig, evaluation: dict) -> dict | None:
    """Build a consistent summary regardless of flow type."""
    if evaluation.get("status") != "completed":
        return None

    critique = evaluation.get("critique", {})
    summary = {"flow_type": flow.flow_type}

    if flow.requires_segments:
        # Upload: count from segments
        segments = critique.get("segments", [])
        total = len(segments)
        if total > 0:
            stats = critique.get("statistics", {})
            matches = stats.get("matchCount", sum(
                1 for s in segments
                if (s.get("severity", "").lower() == "none"
                    or s.get("accuracy", "").lower() in ("match", "none"))
            ))
            summary["overall_accuracy"] = matches / total
            summary["total_items"] = total
            severity_dist = _count_severity(segments, key="severity")
            summary["severity_distribution"] = severity_dist
            summary["critical_errors"] = severity_dist.get("CRITICAL", 0)
            summary["moderate_errors"] = severity_dist.get("MODERATE", 0)
            summary["minor_errors"] = severity_dist.get("MINOR", 0)
            if stats.get("overallScore") is not None:
                summary["overall_score"] = stats["overallScore"]
    else:
        # API: count from fieldCritiques
        field_critiques = critique.get("fieldCritiques", [])
        total = len(field_critiques)
        if total > 0:
            matches = sum(1 for fc in field_critiques if fc.get("match", False))
            summary["overall_accuracy"] = matches / total
            summary["total_items"] = total
            severity_dist = _count_severity(field_critiques, key="severity")
            summary["severity_distribution"] = severity_dist
            summary["critical_errors"] = severity_dist.get("CRITICAL", 0)
            summary["moderate_errors"] = severity_dist.get("MODERATE", 0)
            summary["minor_errors"] = severity_dist.get("MINOR", 0)

        # Also check for well-known score keys from rawOutput
        raw = critique.get("rawOutput", {})
        for score_key in ["overall_score", "accuracy_score", "factual_integrity_score"]:
            if raw.get(score_key) is not None:
                summary["overall_score"] = raw[score_key]
                break

    return summary if len(summary) > 1 else None


def _count_severity(items: list, key: str = "severity") -> dict:
    """Count severity distribution from a list of items."""
    dist = {}
    for item in items:
        sev = str(item.get(key, "none")).upper()
        dist[sev] = dist.get(sev, 0) + 1
    return dist


def _extract_field_critiques_from_raw(raw_critique: dict) -> list[dict]:
    """Extract normalized field critiques from API critique response."""
    # Classic shape
    if raw_critique.get("structuredComparison", {}).get("fields"):
        return raw_critique["structuredComparison"]["fields"]

    # Schema-driven shape (rawOutput.field_critiques)
    raw = raw_critique.get("rawOutput", raw_critique)
    if isinstance(raw.get("field_critiques"), list):
        result = []
        for fc in raw["field_critiques"]:
            is_pass = str(fc.get("verdict", "")).lower() == "pass"
            result.append({
                "fieldPath": str(fc.get("field_name", "")),
                "apiValue": fc.get("extracted_value"),
                "judgeValue": fc.get("correction") or fc.get("extracted_value"),
                "match": is_pass,
                "critique": str(fc.get("reasoning", "")),
                "severity": "none" if is_pass else ("critical" if fc.get("error_type") == "contradiction" else "moderate"),
                "confidence": "high",
                "evidenceSnippet": fc.get("evidence_snippet"),
            })
        return result

    return []
