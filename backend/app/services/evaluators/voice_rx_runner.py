"""Voice-RX evaluation runner — two-call pipeline (transcription + critique).

Runs the same evaluation pipeline that previously executed in the browser:
  Call 1: Audio → AI transcript (or skip if reusing existing)
  Call 2: Audio + original + AI transcript → per-segment critique

Called by the job worker when processing 'evaluate-voice-rx' jobs.
"""
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, update

from app.database import async_session
from app.models.listing import Listing
from app.models.file_record import FileRecord
from app.models.job import Job
from app.models.eval_run import ApiLog
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
from app.services.job_worker import is_job_cancelled, JobCancelledError

logger = logging.getLogger(__name__)


# ── Normalization prompt (ported from normalizationService.ts) ───

NORMALIZATION_PROMPT = """You are an expert in Hindi-English transliteration and Indian language processing.

TASK: Transliterate the following transcript from {source_script} script to {target_script} script.

RULES:
1. Convert all Devanagari text to Roman script using standard transliteration (e.g., "ये" → "ye", "कभी" → "kabhi")
2. Preserve English words exactly as-is
3. Keep speaker labels unchanged
4. Keep timestamps unchanged (startTime, endTime, startSeconds, endSeconds)
5. Maintain medical terminology accurately
6. For code-switched content (Hinglish), transliterate Hindi portions while keeping English portions intact
7. Return EXACT same JSON structure with same number of segments

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
                    "startTime": {"type": "string"},
                    "endTime": {"type": "string"},
                },
                "required": ["speaker", "text", "startTime", "endTime"],
            },
        },
    },
    "required": ["segments"],
}


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


async def _update_progress(job_id, current: int, total: int, message: str, listing_id: str = ""):
    """Update job progress with listing_id for frontend tracking."""
    progress = {
        "current": current,
        "total": total,
        "message": message,
    }
    if listing_id:
        progress["listing_id"] = listing_id
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

    # Write listing_id to progress early so frontend can track
    await _update_progress(job_id, 0, 3, "Initializing...", listing_id)

    # ── Load listing ─────────────────────────────────────────────
    async with async_session() as db:
        listing = await db.get(Listing, listing_id)
        if not listing:
            raise ValueError(f"Listing {listing_id} not found")

    audio_file_meta = listing.audio_file
    if not audio_file_meta:
        raise ValueError(f"Listing {listing_id} has no audio file")

    # Load audio bytes
    file_id = audio_file_meta.get("id")
    async with async_session() as db:
        file_record = await db.get(FileRecord, file_id)
        if not file_record:
            raise ValueError(f"File record {file_id} not found")

    audio_bytes = await file_storage.read(file_record.storage_path)
    mime_type = file_record.mime_type or audio_file_meta.get("mimeType", "audio/mpeg")

    # ── Resolve LLM settings ────────────────────────────────────
    from app.services.evaluators.settings_helper import get_llm_settings_from_db
    db_settings = await get_llm_settings_from_db(app_id=None, key="llm-settings")
    api_key = db_settings["api_key"]
    provider = db_settings["provider"]

    transcription_model = params.get("transcription_model") or db_settings["selected_model"]
    evaluation_model = params.get("evaluation_model") or db_settings["selected_model"]

    # ── Create LLM providers ────────────────────────────────────
    # Use a simple run_id for logging (not creating EvalRun for voice-rx single-listing evals)
    run_id = f"vrx-{listing_id[:8]}"

    def _create_llm(model: str) -> BaseLLMProvider:
        inner = create_llm_provider(
            provider=provider, api_key=api_key,
            model_name=model, temperature=0.3,
        )
        llm = LoggingLLMWrapper(inner, log_callback=_save_api_log)
        llm.set_context(run_id)
        return llm

    # ── Extract params ───────────────────────────────────────────
    transcription_prompt = params.get("transcription_prompt", "")
    evaluation_prompt = params.get("evaluation_prompt", "")
    transcription_schema = params.get("transcription_schema")
    evaluation_schema = params.get("evaluation_schema")
    skip_transcription = params.get("skip_transcription", False)
    normalize_original = params.get("normalize_original", False)
    prerequisites = params.get("prerequisites", {})

    source_type = listing.source_type or "upload"
    is_api_flow = source_type == "api"

    # Determine step count
    total_steps = 0
    if not skip_transcription:
        total_steps += 1
    if normalize_original and not is_api_flow:
        total_steps += 1
    total_steps += 1  # critique always runs

    # Build the AIEvaluation result (camelCase keys for frontend compat)
    evaluation = {
        "id": f"eval-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "model": transcription_model,
        "status": "processing",
        "prompts": {
            "transcription": transcription_prompt,
            "evaluation": evaluation_prompt,
        },
    }

    current_step = 0

    try:
        # ── Check cancellation helper ────────────────────────────
        async def check_cancel():
            if await is_job_cancelled(job_id):
                raise JobCancelledError("Job was cancelled by user")

        if is_api_flow:
            # ══════════════════════════════════════════════════════
            # API FLOW
            # ══════════════════════════════════════════════════════
            llm_transcription = _create_llm(transcription_model)
            llm_evaluation = _create_llm(evaluation_model)

            # Call 1: Transcribe + extract structured data
            current_step += 1
            await _update_progress(job_id, current_step, total_steps, "Judge is transcribing audio...", listing_id)
            await check_cancel()

            api_schema = transcription_schema
            if not api_schema:
                raise ValueError("No API response schema configured for transcription.")

            response_text = await llm_transcription.generate_with_audio(
                prompt=transcription_prompt,
                audio_bytes=audio_bytes,
                mime_type=mime_type,
                json_schema=api_schema,
            )
            await check_cancel()

            parsed = _safe_parse_json(response_text)
            judge_transcript = str(parsed.get("input", ""))
            judge_structured = parsed.get("rx", {})

            evaluation["judgeOutput"] = {
                "transcript": judge_transcript,
                "structuredData": judge_structured,
            }

            # Call 2: Compare API output vs Judge output
            current_step += 1
            await _update_progress(job_id, current_step, total_steps, "Comparing outputs...", listing_id)
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
            full_prompt = f"{evaluation_prompt}{api_output_text}{judge_output_text}"

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
                # Reuse existing AI transcript
                existing_eval = listing.ai_eval or {}
                llm_transcript_data = existing_eval.get("llmTranscript")
                if not llm_transcript_data:
                    raise ValueError("Cannot skip transcription: no existing AI transcript available.")
                evaluation["llmTranscript"] = llm_transcript_data
                # Preserve original prompts/schemas
                if existing_eval.get("prompts", {}).get("transcription"):
                    evaluation["prompts"]["transcription"] = existing_eval["prompts"]["transcription"]
            else:
                # Call 1: Transcription
                current_step += 1
                await _update_progress(job_id, current_step, total_steps, "Transcribing audio...", listing_id)
                await check_cancel()

                llm_transcription = _create_llm(transcription_model)

                # Resolve prompt variables
                resolve_ctx = {
                    "listing": {
                        "transcript": listing.transcript,
                        "sourceType": source_type,
                        "apiResponse": listing.api_response,
                    },
                    "prerequisites": prerequisites,
                }
                resolved = resolve_prompt(transcription_prompt, resolve_ctx)
                prompt_text = resolved["prompt"]
                # Strip {{audio}} placeholder since we send audio as file
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
                await _update_progress(job_id, current_step, total_steps, "Normalizing transcript...", listing_id)
                await check_cancel()

                target_script = prerequisites.get("targetScript", prerequisites.get("target_script", "Roman"))
                source_script = prerequisites.get("sourceScript", prerequisites.get("source_script", "Devanagari"))

                norm_prompt = NORMALIZATION_PROMPT.format(
                    source_script=source_script,
                    target_script=target_script,
                    transcript_json=json.dumps(original_for_critique, indent=2),
                )

                norm_model = prerequisites.get("normalizationModel") or transcription_model
                llm_norm = _create_llm(norm_model)

                norm_text = await llm_norm.generate_json(
                    prompt=norm_prompt,
                    json_schema=NORMALIZATION_SCHEMA,
                )
                await check_cancel()

                # norm_text is already parsed dict from generate_json
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
            await _update_progress(job_id, current_step, total_steps, "Generating critique...", listing_id)
            await check_cancel()

            llm_evaluation = _create_llm(evaluation_model)

            # Resolve evaluation prompt variables
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

        # ── Save result to listing ───────────────────────────────
        async with async_session() as db:
            await db.execute(
                update(Listing).where(Listing.id == listing_id).values(
                    ai_eval=evaluation,
                )
            )
            await db.commit()

        duration = time.monotonic() - start_time
        return {
            "listing_id": listing_id,
            "status": "completed",
            "duration_seconds": round(duration, 2),
        }

    except JobCancelledError:
        evaluation["status"] = "cancelled"
        async with async_session() as db:
            await db.execute(
                update(Listing).where(Listing.id == listing_id).values(
                    ai_eval=evaluation,
                )
            )
            await db.commit()
        logger.info("Voice-RX evaluation for %s cancelled", listing_id)
        return {"listing_id": listing_id, "status": "cancelled"}

    except Exception as e:
        evaluation["status"] = "failed"
        evaluation["error"] = str(e)
        async with async_session() as db:
            await db.execute(
                update(Listing).where(Listing.id == listing_id).values(
                    ai_eval=evaluation,
                )
            )
            await db.commit()
        raise
