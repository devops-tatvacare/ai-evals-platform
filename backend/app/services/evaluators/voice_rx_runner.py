"""Voice-RX evaluation runner — two-call pipeline (transcription + critique).

Creates eval_runs rows (eval_type='full_evaluation') as the single source of truth.
Called by the job worker when processing 'evaluate-voice-rx' jobs.

Standard pipeline contract:
  - Transcription prompt/schema: loaded from DB defaults (seed_defaults.py)
  - Evaluation prompt/schema: hardcoded constants below (never user-configurable)
  - Comparison table: built server-side, injected into prompt
  - Statistics: computed server-side from known data (never trust LLM counts)
  - Critique step: text-only (generate_json, NOT generate_with_audio)
"""
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from sqlalchemy import select, update

from app.database import async_session
from app.models.listing import Listing
from app.models.file_record import FileRecord
from app.models.prompt import Prompt
from app.models.schema import Schema
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
)
from app.services.evaluators.prompt_resolver import resolve_prompt
from app.services.evaluators.flow_config import FlowConfig
from app.services.job_worker import is_job_cancelled, JobCancelledError, safe_error_message

logger = logging.getLogger(__name__)


# ── Normalization helpers ────────────────────────────────────────

# Map script IDs (from frontend) to human-readable names for prompts
SCRIPT_DISPLAY_NAMES = {
    "latin": "Latin (Roman/English alphabet)",
    "devanagari": "Devanagari",
    "arabic": "Arabic",
    "bengali": "Bengali",
    "tamil": "Tamil",
    "telugu": "Telugu",
    "kannada": "Kannada",
    "malayalam": "Malayalam",
    "gujarati": "Gujarati",
    "gurmukhi": "Gurmukhi",
    "odia": "Odia",
    "sinhala": "Sinhala",
    "cjk": "CJK (Chinese/Japanese)",
    "hangul": "Hangul (Korean)",
    "hiragana": "Hiragana",
    "katakana": "Katakana",
    "cyrillic": "Cyrillic",
    "thai": "Thai",
    "hebrew": "Hebrew",
    "greek": "Greek",
    "myanmar": "Myanmar",
    "ethiopic": "Ethiopic",
    "khmer": "Khmer",
    "georgian": "Georgian",
}


def _resolve_script_name(script_id: str) -> str:
    """Convert a script ID to a human-readable name for use in prompts."""
    if not script_id or script_id == "auto":
        return ""  # Caller handles auto case
    return SCRIPT_DISPLAY_NAMES.get(script_id, script_id.title())


# ── Normalization prompt templates ───────────────────────────────

# {source_instruction} is either "from X script" or "auto-detect the source script"
# {target_script} is always a concrete script name (never "auto")
NORMALIZATION_PROMPT = """You are an expert multilingual transliteration specialist.

TASK: Transliterate the following transcript into {target_script} script.
{source_instruction}
Source language: {language}

CRITICAL: Every "text" field in your output MUST be written in {target_script} characters. Do NOT return text in the original script.

RULES:
1. Convert ALL text into {target_script} script using standard transliteration conventions for {language}
2. Preserve proper nouns, technical/medical terminology, and widely-known abbreviations in their original form
3. Keep speaker labels unchanged
4. Keep timestamps unchanged (startTime, endTime, startSeconds, endSeconds)
5. For code-switched content (multiple languages mixed), transliterate the {language} portions while keeping other language portions intact
6. Return EXACT same JSON structure with same number of segments
7. If the text is already in {target_script} script, return it unchanged

INPUT TRANSCRIPT:
{transcript_json}

OUTPUT: Return the transliterated transcript in JSON format. ALL text MUST be in {target_script} script."""

NORMALIZATION_PROMPT_PLAIN = """You are an expert multilingual transliteration specialist.

TASK: Transliterate the following transcript text into {target_script} script.
{source_instruction}
Source language: {language}

CRITICAL: Your output MUST be written entirely in {target_script} characters. Do NOT return text in the original script.

RULES:
1. Convert ALL text into {target_script} script using standard transliteration conventions for {language}
2. Preserve proper nouns, technical/medical terminology, and widely-known abbreviations in their original form
3. Keep speaker labels (e.g., [Doctor]:, [Patient]:) unchanged
4. For code-switched content (multiple languages mixed), transliterate the {language} portions while keeping other language portions intact
5. If the text is already in {target_script} script, return it unchanged
6. Preserve line breaks and formatting

INPUT TRANSCRIPT:
{transcript_text}

OUTPUT: Return the transliterated transcript text. ALL text MUST be in {target_script} script."""


def _build_normalization_schema(target_script: str) -> dict:
    """Build normalization schema with target script constraint in text description."""
    return {
        "type": "object",
        "properties": {
            "segments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "speaker": {"type": "string"},
                        "text": {"type": "string", "description": f"Transliterated text — MUST be in {target_script} script"},
                        "startTime": {"type": "string", "description": "Exact start time in HH:MM:SS format — must match the original transcript time window exactly, do not modify or approximate"},
                        "endTime": {"type": "string", "description": "Exact end time in HH:MM:SS format — must match the original transcript time window exactly, do not modify or approximate"},
                    },
                    "required": ["speaker", "text", "startTime", "endTime"],
                },
            },
        },
        "required": ["segments"],
    }


def _build_normalization_schema_plain(target_script: str) -> dict:
    """Build plain-text normalization schema with target script constraint."""
    return {
        "type": "object",
        "properties": {
            "normalized_text": {
                "type": "string",
                "description": f"The full transcript text transliterated into {target_script} script"
            },
        },
        "required": ["normalized_text"],
    }


# ── Hardcoded evaluation prompts (standard pipeline — NOT user-configurable) ───

UPLOAD_EVALUATION_PROMPT = """You are an expert medical transcription auditor acting as a JUDGE.

═══════════════════════════════════════════════════════════════════════════════
TASK: SEGMENT-BY-SEGMENT TRANSCRIPT COMPARISON
═══════════════════════════════════════════════════════════════════════════════

Below is a pre-built comparison table with {segment_count} segments. Each row pairs the ORIGINAL transcript segment (system under test) with the JUDGE transcript segment (your reference from Call 1). Both cover the EXACT same time window.

Your job: For each segment, determine if there is a meaningful discrepancy. If the segments essentially match, do NOT include that segment in your output — only report segments with actual discrepancies.

═══════════════════════════════════════════════════════════════════════════════
SEGMENT COMPARISON TABLE
═══════════════════════════════════════════════════════════════════════════════

{comparison_table}

═══════════════════════════════════════════════════════════════════════════════
SEVERITY CLASSIFICATION
═══════════════════════════════════════════════════════════════════════════════

CRITICAL (Patient safety risk):
  - Medication dosage errors (10mg vs 100mg)
  - Wrong drug names (Celebrex vs Cerebyx)
  - Missed allergies or contraindications
  - Incorrect procedure/diagnosis

MODERATE (Clinical meaning affected):
  - Speaker misattribution affecting context
  - Missing medical history elements
  - Incomplete symptom descriptions

MINOR (No clinical impact):
  - Filler words (um, uh, you know)
  - Minor punctuation differences
  - Paraphrasing with same meaning

═══════════════════════════════════════════════════════════════════════════════
OUTPUT RULES
═══════════════════════════════════════════════════════════════════════════════

- ONLY output segments that have a discrepancy (severity != none)
- Segments not in your output are assumed to be matches
- For each discrepancy segment, provide: segmentIndex, severity, discrepancy description, likelyCorrect (original/judge/both/unclear), confidence, and category
- Provide an overallAssessment summarizing transcript quality
- Output structure is controlled by the schema — just provide the data"""

UPLOAD_EVALUATION_SCHEMA = {
    "type": "object",
    "properties": {
        "segments": {
            "type": "array",
            "description": "ONLY segments with discrepancies — omit matching segments",
            "items": {
                "type": "object",
                "properties": {
                    "segmentIndex": {"type": "number", "description": "Zero-based index of segment"},
                    "severity": {
                        "type": "string",
                        "enum": ["minor", "moderate", "critical"],
                        "description": "Clinical impact severity",
                    },
                    "discrepancy": {"type": "string", "description": "Description of the difference"},
                    "likelyCorrect": {
                        "type": "string",
                        "enum": ["original", "judge", "both", "unclear"],
                        "description": "Which transcript is likely correct",
                    },
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                        "description": "Confidence in the determination",
                    },
                    "category": {"type": "string", "description": "Error category (e.g., dosage, speaker, terminology)"},
                },
                "required": ["segmentIndex", "severity", "discrepancy", "likelyCorrect"],
            },
        },
        "overallAssessment": {"type": "string", "description": "Summary of overall transcript quality"},
    },
    "required": ["segments", "overallAssessment"],
}

API_EVALUATION_PROMPT = """You are an expert Medical Informatics Auditor evaluating rx JSON accuracy.

═══════════════════════════════════════════════════════════════════════════════
TASK: COMPARE API OUTPUT VS JUDGE OUTPUT
═══════════════════════════════════════════════════════════════════════════════

Below is a pre-built comparison of the API system's output against the Judge AI's independent output. Compare both the transcript text and the structured data fields.

{comparison}

═══════════════════════════════════════════════════════════════════════════════
EVALUATION DIMENSIONS
═══════════════════════════════════════════════════════════════════════════════

1. TRANSCRIPT COMPARISON: Are the transcripts semantically equivalent?
2. STRUCTURED DATA COMPARISON: For each field in the structured output:
   - Does the API value match the Judge value?
   - If not, classify the error (contradiction, hallucination, omission, mismatch)
   - Rate severity (none, minor, moderate, critical)

═══════════════════════════════════════════════════════════════════════════════
OUTPUT RULES
═══════════════════════════════════════════════════════════════════════════════

- Compare transcripts and provide a summary with discrepancies
- For structured data, evaluate EVERY field and mark match/mismatch
- Provide an overallAssessment summarizing API system quality
- Output structure is controlled by the schema — just provide the data"""

API_EVALUATION_SCHEMA = {
    "type": "object",
    "properties": {
        "transcriptComparison": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Summary of transcript comparison"},
                "discrepancies": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "severity": {"type": "string", "enum": ["minor", "moderate", "critical"]},
                        },
                        "required": ["description", "severity"],
                    },
                },
            },
            "required": ["summary"],
        },
        "structuredComparison": {
            "type": "object",
            "properties": {
                "fields": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "fieldPath": {"type": "string", "description": "JSON path to the field"},
                            "apiValue": {"description": "Value from API output"},
                            "judgeValue": {"description": "Value from Judge output"},
                            "match": {"type": "boolean", "description": "Whether values match"},
                            "critique": {"type": "string", "description": "Explanation of difference or match"},
                            "severity": {
                                "type": "string",
                                "enum": ["none", "minor", "moderate", "critical"],
                            },
                            "confidence": {
                                "type": "string",
                                "enum": ["low", "medium", "high"],
                            },
                            "evidenceSnippet": {"type": "string", "description": "Quote from transcript"},
                        },
                        "required": ["fieldPath", "apiValue", "judgeValue", "match", "critique", "severity"],
                    },
                },
            },
            "required": ["fields"],
        },
        "overallAssessment": {"type": "string", "description": "Overall assessment of API system quality"},
    },
    "required": ["transcriptComparison", "structuredComparison", "overallAssessment"],
}


# ── DB helpers for loading default prompts/schemas ────────────────────

async def _load_default_prompt(app_id: str, prompt_type: str, source_type: str) -> str:
    """Load the default prompt text from the DB for a given app/type/source."""
    async with async_session() as db:
        result = await db.execute(
            select(Prompt).where(
                Prompt.app_id == app_id,
                Prompt.prompt_type == prompt_type,
                Prompt.source_type == source_type,
                Prompt.is_default == True,
            )
        )
        prompt = result.scalar_one_or_none()
        if not prompt:
            raise ValueError(f"No default {prompt_type} prompt for {app_id}/{source_type}")
        return prompt.prompt


async def _load_default_schema(app_id: str, prompt_type: str, source_type: str) -> dict:
    """Load the default schema from the DB for a given app/type/source."""
    async with async_session() as db:
        result = await db.execute(
            select(Schema).where(
                Schema.app_id == app_id,
                Schema.prompt_type == prompt_type,
                Schema.source_type == source_type,
                Schema.is_default == True,
            )
        )
        schema = result.scalar_one_or_none()
        if not schema:
            raise ValueError(f"No default {prompt_type} schema for {app_id}/{source_type}")
        return schema.schema_data


class PipelineStepError(Exception):
    """Error from a specific pipeline step with context."""
    def __init__(self, step: str, message: str, partial_result: dict | None = None):
        self.step = step
        self.message = message
        self.partial_result = partial_result
        super().__init__(f"Step '{step}' failed: {message}")


def _validate_pipeline_inputs(flow, listing, params: dict) -> list[str]:
    """Validate all inputs before starting the pipeline. Returns list of error messages."""
    errors = []

    if not listing.audio_file:
        errors.append("Listing has no audio file")

    if flow.flow_type == "upload":
        if not listing.transcript:
            errors.append("Upload flow requires a transcript")
        elif not listing.transcript.get("segments"):
            errors.append("Upload flow requires transcript with segments")
    elif flow.flow_type == "api":
        if not listing.api_response:
            errors.append("API flow requires an API response (fetch from API first)")

    if flow.normalize_original:
        prereqs = params.get("prerequisites", {})
        if not prereqs.get("targetScript") and not prereqs.get("target_script"):
            errors.append("Normalization requires targetScript in prerequisites")
        if not prereqs.get("sourceScript") and not prereqs.get("source_script"):
            errors.append("Normalization requires sourceScript in prerequisites")

    return errors


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
    """Run voice-rx FlowConfig-driven evaluation pipeline.

    Three-step sequence: transcription -> normalization -> critique.
    Step behavior is controlled by a frozen FlowConfig dataclass, not
    conditional branches.

    Standard pipeline: prompts/schemas loaded internally (not from frontend).
    - Transcription prompt/schema: loaded from DB defaults
    - Evaluation prompt/schema: hardcoded constants (never user-configurable)

    Params (from frontend job submission):
        listing_id: str              - UUID of listing
        app_id: str                  - "voice-rx"
        normalize_original: bool     - normalize original transcript before critique
        prerequisites: dict          - language, targetScript, sourceScript, etc.
        model: str                   - single model for all steps
        timeouts: dict               - timeout overrides
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

    # Single model for all steps (frontend sends one model)
    selected_model = params.get("model") or db_settings["selected_model"]

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
    prerequisites = params.get("prerequisites", {})
    thinking = params.get("thinking", "low")

    # ── Build FlowConfig ─────────────────────────────────────────
    flow = FlowConfig.from_params(params, listing.source_type or "upload")

    # ── Pre-execution validation ──
    errors = _validate_pipeline_inputs(flow, listing, params)
    if errors:
        raise ValueError(f"Pipeline validation failed: {'; '.join(errors)}")

    # ── Load prompts/schemas from DB and hardcoded constants ─────
    transcription_prompt = await _load_default_prompt(app_id, "transcription", flow.flow_type)
    transcription_schema = await _load_default_schema(app_id, "transcription", flow.flow_type)

    # Evaluation schema: hardcoded (standard pipeline, stored in config snapshot only)
    evaluation_schema = UPLOAD_EVALUATION_SCHEMA if flow.requires_segments else API_EVALUATION_SCHEMA

    total_steps = flow.total_steps

    # Store config snapshot
    config_snapshot = {
        "prompts": {
            "transcription": transcription_prompt,
            "evaluation": "[hardcoded standard pipeline]",
        },
        "schemas": {
            "transcription": transcription_schema,
            "evaluation": evaluation_schema,
        },
        "models": {
            "transcription": selected_model,
            "evaluation": selected_model,
        },
        "prerequisites": prerequisites,
        "normalize_original": flow.normalize_original,
        "flow_type": flow.flow_type,
        "auth_method": db_settings["auth_method"],
        "thinking": thinking,
    }

    # Update eval_run with config and LLM info
    async with async_session() as db:
        await db.execute(
            update(EvalRun).where(EvalRun.id == eval_run_id).values(
                config=config_snapshot,
                llm_provider=provider,
                llm_model=selected_model,
            )
        )
        await db.commit()

    # Build the evaluation result (camelCase keys for frontend compat)
    evaluation = {
        "id": str(eval_run_id),
        "createdAt": now.isoformat(),
        "model": selected_model,
        "models": {"transcription": selected_model, "evaluation": selected_model},
        "status": "processing",
        "prompts": {
            "transcription": transcription_prompt,
            "evaluation": "[hardcoded standard pipeline]",
        },
    }

    current_step = 0

    try:
        async def check_cancel():
            if await is_job_cancelled(job_id):
                raise JobCancelledError("Job was cancelled by user")

        # ── STEP 1: Transcription ───────────────────────────────
        current_step += 1
        await _update_progress(
            job_id, current_step, total_steps,
            "Transcribing audio..." if flow.requires_segments else "Judge is transcribing audio...",
            listing_id, str(eval_run_id),
        )
        await check_cancel()

        try:
            transcription_result = await _run_transcription(
                flow=flow,
                llm=_create_llm(selected_model),
                listing=listing,
                audio_bytes=audio_bytes,
                mime_type=mime_type,
                prompt_text=transcription_prompt,
                schema=transcription_schema,
                prerequisites=prerequisites,
                thinking=thinking,
            )
            evaluation.update(transcription_result)
        except JobCancelledError:
            raise
        except Exception as e:
            raise PipelineStepError(
                step="transcription",
                message=safe_error_message(e),
                partial_result=dict(evaluation),
            ) from e

        # Validate judge output before proceeding
        if not flow.requires_segments:
            judge = evaluation.get("judgeOutput", {})
            if not judge.get("structuredData") or not isinstance(judge["structuredData"], dict):
                raise PipelineStepError(
                    step="transcription",
                    message="Judge did not produce structured rx data — cannot compare against API output",
                    partial_result=dict(evaluation),
                )

        await check_cancel()

        # ── STEP 2: Normalization (optional) ────────────────────
        if flow.normalize_original:
            current_step += 1
            await _update_progress(
                job_id, current_step, total_steps,
                "Normalizing transcript...", listing_id, str(eval_run_id),
            )
            await check_cancel()

            try:
                norm_model = (
                    prerequisites.get("normalizationModel")
                    or prerequisites.get("normalization_model")
                    or selected_model
                )
                norm_result = await _run_normalization(
                    flow=flow,
                    llm=_create_llm(norm_model),
                    listing=listing,
                    prerequisites=prerequisites,
                    thinking=thinking,
                )
                evaluation.update(norm_result)
            except JobCancelledError:
                raise
            except Exception as e:
                # Normalization failure is non-fatal — log warning and continue
                logger.warning("Normalization failed for %s: %s", listing_id, e)
                evaluation.setdefault("warnings", []).append(
                    f"Normalization failed: {safe_error_message(e)}. Continuing without normalization."
                )

            await check_cancel()

        # ── STEP 3: Critique ───────────────────────────────────
        current_step += 1
        await _update_progress(
            job_id, current_step, total_steps,
            "Generating critique..." if flow.requires_segments else "Comparing outputs...",
            listing_id, str(eval_run_id),
        )
        await check_cancel()

        try:
            critique_result = await _run_critique(
                flow=flow,
                llm=_create_llm(selected_model),
                listing=listing,
                prerequisites=prerequisites,
                evaluation=evaluation,
                thinking=thinking,
            )
            evaluation.update(critique_result)
        except JobCancelledError:
            raise
        except Exception as e:
            raise PipelineStepError(
                step="critique",
                message=safe_error_message(e),
                partial_result=dict(evaluation),
            ) from e

        evaluation["status"] = "completed"
        evaluation["flowType"] = flow.flow_type

        # ── STEP 4: Summary (always) ──────────────────────────
        summary_data = _build_summary(flow, evaluation)

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

    except PipelineStepError as e:
        # Save partial result with step-specific error
        evaluation["status"] = "failed"
        evaluation["error"] = e.message
        evaluation["failedStep"] = e.step
        if e.partial_result:
            for k, v in e.partial_result.items():
                if k not in evaluation:
                    evaluation[k] = v

        async with async_session() as db:
            await db.execute(
                update(EvalRun).where(
                    EvalRun.id == eval_run_id,
                    EvalRun.status != "cancelled",
                ).values(
                    status="failed",
                    completed_at=datetime.now(timezone.utc),
                    duration_ms=(time.monotonic() - start_time) * 1000,
                    error_message=f"[{e.step}] {e.message}",
                    result=evaluation,
                )
            )
            await db.commit()
        raise

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
    prompt_text, schema, prerequisites, thinking: str = "low",
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
        thinking=thinking,
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
        # API flow: response must have {input, rx} matching real API shape
        parsed = json.loads(response_text) if isinstance(response_text, str) else response_text

        judge_transcript = parsed.get("input", "")
        judge_rx = parsed.get("rx")

        if not judge_transcript and not judge_rx:
            raise PipelineStepError(
                "transcription",
                "Judge produced empty response — no 'input' or 'rx' data. "
                "Check that the transcription schema has {input, rx} fields.",
            )

        if not isinstance(judge_rx, dict):
            raise PipelineStepError(
                "transcription",
                f"Judge 'rx' field is {type(judge_rx).__name__}, expected dict. "
                "The transcription schema may be wrong.",
            )

        return {
            "judgeOutput": {
                "transcript": judge_transcript,
                "structuredData": judge_rx,
            },
        }


async def _run_normalization(
    flow: FlowConfig, llm, listing, prerequisites, thinking: str = "low",
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
        thinking=thinking,
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


def _get_normalization_source(listing, _flow: FlowConfig):
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


async def _normalize_transcript(llm, transcript_input, source_script, target_script, language, thinking: str = "low") -> dict | None:
    """Core normalization function. Accepts any format, returns consistent shape.

    Input: str or dict-with-segments
    Output: { "fullTranscript": str, "segments"?: [...] } or None
    """
    # Resolve script IDs to human-readable names
    target_display = _resolve_script_name(target_script) or target_script
    source_display = _resolve_script_name(source_script)

    # Build source instruction — handle "auto" explicitly
    if not source_display or source_script == "auto":
        source_instruction = "The source script should be auto-detected from the input text."
    else:
        source_instruction = f"The source text is in {source_display} script."

    has_segments = (isinstance(transcript_input, dict)
                    and isinstance(transcript_input.get("segments"), list)
                    and len(transcript_input["segments"]) > 0)

    if has_segments:
        # ── Segment-level normalization ──
        prompt = NORMALIZATION_PROMPT.format(
            target_script=target_display,
            source_instruction=source_instruction,
            language=language,
            transcript_json=json.dumps(transcript_input, indent=2),
        )
        schema = _build_normalization_schema(target_display)
        result = await llm.generate_json(prompt=prompt, json_schema=schema, thinking=thinking)

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
            target_script=target_display,
            source_instruction=source_instruction,
            language=language,
            transcript_text=text,
        )
        schema = _build_normalization_schema_plain(target_display)
        result = await llm.generate_json(prompt=prompt, json_schema=schema, thinking=thinking)

        normalized_text = result.get("normalized_text", "").strip()
        if not normalized_text:
            return None

        return {
            "fullTranscript": normalized_text,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }


async def _run_critique(
    flow: FlowConfig, llm, listing, prerequisites, evaluation, thinking: str = "low",
) -> dict:
    """Step 3: Critique/comparison — TEXT ONLY (no audio).

    Uses generate_json() — NOT generate_with_audio().
    Prompt and schema are hardcoded constants, not user-configurable.
    Comparison table is built server-side and injected into prompt.

    Upload flow: Segment-level comparison (original vs judge).
    API flow: Field-level comparison (API output vs judge output).

    Returns dict to merge into evaluation:
      { "critique": { unified shape }, "_original_segment_count": int }
    """
    judge_output = evaluation.get("judgeOutput", {})
    normalized = evaluation.get("normalizedOriginal")

    if flow.requires_segments:
        # ── Upload flow critique ──
        # Use normalized transcript if available, else original
        original_transcript = listing.transcript or {}
        if normalized and "segments" in normalized:
            original_transcript = {**listing.transcript, **normalized}

        original_segments = original_transcript.get("segments", [])
        judge_segments = judge_output.get("segments", [])
        total_segments = max(len(original_segments), len(judge_segments))

        # Build indexed comparison table (server-side)
        table_lines = []
        for i in range(total_segments):
            orig = original_segments[i] if i < len(original_segments) else {}
            judge = judge_segments[i] if i < len(judge_segments) else {}
            orig_speaker = orig.get("speaker", "?")
            orig_text = orig.get("text", "[missing]")
            judge_speaker = judge.get("speaker", "?")
            judge_text = judge.get("text", "[missing]")
            table_lines.append(
                f"Segment {i}: Original=[{orig_speaker}]: {orig_text} | Judge=[{judge_speaker}]: {judge_text}"
            )
        comparison_table = "\n".join(table_lines)

        # Format prompt with table (no template variables)
        prompt = UPLOAD_EVALUATION_PROMPT.format(
            segment_count=total_segments,
            comparison_table=comparison_table,
        )

        # Call generate_json — NO AUDIO
        critique_text = await llm.generate_json(
            prompt=prompt,
            json_schema=UPLOAD_EVALUATION_SCHEMA,
            thinking=thinking,
        )

        # critique_text is already a dict from generate_json
        if isinstance(critique_text, dict):
            parsed_critique = critique_text
        else:
            parsed_critique = parse_critique_response(
                critique_text, original_segments, judge_segments, llm.model_name,
                total_segments=total_segments,
            )

        # Build critique segments with back-fill
        critique_segments = []
        for seg in parsed_critique.get("segments", []):
            seg_idx = seg.get("segmentIndex", 0)
            critique_segments.append({
                "segmentIndex": seg_idx,
                "originalText": (original_segments[seg_idx].get("text", "") if seg_idx < len(original_segments) else ""),
                "judgeText": (judge_segments[seg_idx].get("text", "") if seg_idx < len(judge_segments) else ""),
                "discrepancy": str(seg.get("discrepancy", "")),
                "likelyCorrect": str(seg.get("likelyCorrect", "unclear")),
                "confidence": seg.get("confidence"),
                "severity": str(seg.get("severity", "minor")),
                "category": seg.get("category"),
            })

        # Server-side statistics (never trust LLM counts)
        critique_indices = {s["segmentIndex"] for s in critique_segments}
        match_count = total_segments - len(critique_indices)
        stats = {
            "totalSegments": total_segments,
            "criticalCount": sum(1 for s in critique_segments if s["severity"] == "critical"),
            "moderateCount": sum(1 for s in critique_segments if s["severity"] == "moderate"),
            "minorCount": sum(1 for s in critique_segments if s["severity"] == "minor"),
            "matchCount": match_count,
            "originalCorrectCount": sum(1 for s in critique_segments if s["likelyCorrect"] == "original"),
            "judgeCorrectCount": sum(1 for s in critique_segments if s["likelyCorrect"] == "judge"),
            "unclearCount": sum(1 for s in critique_segments if s["likelyCorrect"] == "unclear"),
        }

        return {
            "critique": {
                "flowType": "upload",
                "overallAssessment": str(parsed_critique.get("overallAssessment", "")),
                "statistics": stats,
                "segments": critique_segments,
                "rawOutput": parsed_critique,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "model": llm.model_name,
            },
            "_original_segment_count": total_segments,
        }
    else:
        # ── API flow critique ──
        api_response = listing.api_response or {}
        api_transcript = api_response.get("input", "")
        api_rx = api_response.get("rx", {})
        judge_transcript = judge_output.get("transcript", "")
        judge_rx = judge_output.get("structuredData", {})

        # Build field-by-field comparison (structured, not raw JSON dumps)
        comparison_parts = [
            "=== TRANSCRIPT COMPARISON ===",
            f"API TRANSCRIPT:\n{api_transcript}",
            f"\nJUDGE TRANSCRIPT:\n{judge_transcript}",
        ]

        # Compare each rx field side by side
        all_rx_keys = sorted(set(list(api_rx.keys()) + list(judge_rx.keys())))
        for key in all_rx_keys:
            api_val = api_rx.get(key, "(absent)")
            judge_val = judge_rx.get(key, "(absent)")
            comparison_parts.append(
                f"\n=== FIELD: {key} ===\n"
                f"API:   {json.dumps(api_val, indent=2, ensure_ascii=False)}\n"
                f"JUDGE: {json.dumps(judge_val, indent=2, ensure_ascii=False)}"
            )

        comparison_text = "\n".join(comparison_parts)

        prompt = API_EVALUATION_PROMPT.format(comparison=comparison_text)

        raw_critique = await llm.generate_json(
            prompt=prompt,
            json_schema=API_EVALUATION_SCHEMA,
            thinking=thinking,
        )

        if isinstance(raw_critique, str):
            raw_critique = parse_api_critique_response(raw_critique, llm.model_name)

        raw_critique["generatedAt"] = datetime.now(timezone.utc).isoformat()
        raw_critique["model"] = llm.model_name

        return {
            "critique": {
                "flowType": "api",
                "overallAssessment": str(raw_critique.get("overallAssessment", "")),
                "transcriptComparison": raw_critique.get("transcriptComparison"),
                "fieldCritiques": _extract_field_critiques_from_raw(raw_critique),
                "rawOutput": raw_critique,
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
        # Upload: use server-computed statistics (never trust LLM counts)
        stats = critique.get("statistics", {})
        total = stats.get("totalSegments", 0)
        if total > 0:
            match_count = stats.get("matchCount", 0)
            summary["overall_accuracy"] = match_count / total
            summary["total_items"] = total
            discrepancy_segments = critique.get("segments", [])
            severity_dist = _count_severity(discrepancy_segments, key="severity")
            summary["severity_distribution"] = severity_dist
            summary["critical_errors"] = severity_dist.get("CRITICAL", 0)
            summary["moderate_errors"] = severity_dist.get("MODERATE", 0)
            summary["minor_errors"] = severity_dist.get("MINOR", 0)
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
    structured = raw_critique.get("structuredComparison") or {}
    if structured.get("fields"):
        return structured["fields"]

    # Schema-driven shape (rawOutput.field_critiques)
    raw = raw_critique.get("rawOutput") or raw_critique
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
