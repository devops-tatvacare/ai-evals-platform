"""Server-side prompt / schema / structured-extraction helpers.

Replaces the legacy browser-side LLM pipeline. Every call resolves credentials
via ``resolve_credentials`` upstream and is wrapped in
``LoggingLLMWrapper`` so cost tracking continues to record
``analytics.fact_llm_generation`` rows.
"""
from __future__ import annotations

import base64
import json
import logging
import uuid
from typing import Optional

from app.services.evaluators.llm_base import (
    BaseLLMProvider,
    LoggingLLMWrapper,
    create_llm_provider,
)
from app.services.evaluators.runner_utils import make_usage_callback
from app.services.llm_credentials import ResolvedCredentials


logger = logging.getLogger(__name__)


# Ported verbatim from src/constants/prompts.ts (PROMPT_GENERATOR_SYSTEM_PROMPT).
_PROMPT_GENERATOR_SYSTEM_PROMPT = """You are an elite prompt engineer. Your task is to transform a brief idea into a comprehensive, production-ready prompt.

PROMPT TYPE: {prompt_type}
USER'S IDEA: {user_idea}

PROMPT ENGINEERING PRINCIPLES TO APPLY:

1. **Role & Expertise**: Define a clear expert persona with relevant credentials
2. **Context Setting**: Establish the scenario and constraints
3. **Structured Instructions**: Use numbered steps for complex tasks
4. **Output Format**: Specify exact format (JSON, markdown, etc.) with examples
5. **Edge Cases**: Address potential ambiguities and error handling
6. **Quality Gates**: Include validation criteria and success metrics
7. **Constraints**: Define boundaries (length, scope, forbidden actions)

PROMPT TYPE-SPECIFIC GUIDANCE:

For TRANSCRIPTION prompts:
- Focus on audio-to-text accuracy
- Speaker identification requirements
- Handling of medical terminology
- Timestamp and segment formatting
- Handling unclear/inaudible sections

For EVALUATION prompts:
- Comparison methodology between source and target
- Severity classification system
- Category taxonomy for errors
- JSON output structure for programmatic processing
- Reference to available variables: {{transcript}}, {{llm_transcript}}, {{audio}}

For EXTRACTION prompts:
- Data schema definition
- Field validation rules
- Handling missing/uncertain data
- JSON output structure

GENERATION RULES:
1. Output ONLY the generated prompt - no explanations or meta-commentary
2. Make it immediately usable without modifications
3. Include placeholder variables using {{variable}} syntax where appropriate
4. Keep it concise but comprehensive
5. Use professional, clear language
6. Ensure the prompt will produce consistent, parseable outputs

Generate the prompt now:"""


# Ported verbatim from src/constants/prompts.ts (SCHEMA_GENERATOR_SYSTEM_PROMPT).
_SCHEMA_GENERATOR_SYSTEM_PROMPT = """You are a JSON Schema architect specializing in structured LLM output definitions.

TASK: Generate a JSON Schema for {prompt_type} output in a medical transcription evaluation platform.

USER REQUIREMENTS:
{user_idea}

JSON SCHEMA RULES (Gemini SDK Compatible)

1. ROOT STRUCTURE
   - Must be type: "object" at root
   - Must have "properties" object
   - Must have "required" array

2. SUPPORTED TYPES
   - string, number, integer, boolean, array, object
   - Use "enum" for fixed choices: { "type": "string", "enum": ["a", "b", "c"] }

3. ARRAY ITEMS
   - Arrays must define "items" with full schema

4. NESTED OBJECTS
   - Objects need their own "properties" and "required"

MEDICAL EVAL BEST PRACTICES:
- Include segmentIndex (number) for segment-level data
- Use severity enums: ["none", "minor", "moderate", "critical"]
- Add confidence scores (0-1) where uncertainty exists
- Include category fields for error classification
- Add statistics object for aggregate metrics
- Mark clinically critical fields as required

OUTPUT FORMAT:
Return ONLY the JSON Schema object. No markdown, no explanation.
Must be valid JSON parseable by JSON.parse()."""


_SCHEMA_META_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "type": {"type": "string"},
        "properties": {"type": "object"},
        "required": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["type"],
}


def _provider_kwargs(creds: ResolvedCredentials) -> dict:
    if creds.provider == "azure_openai":
        return {
            "azure_endpoint": creds.extra_config.get("base_url") or "",
            "api_version": creds.extra_config.get("api_version", "2025-03-01-preview"),
        }
    return {}


def _build_logging_llm(
    *,
    creds: ResolvedCredentials,
    model: str,
    tenant_id: uuid.UUID,
    user_id: Optional[uuid.UUID],
    call_purpose: str,
    temperature: float = 0.1,
) -> LoggingLLMWrapper:
    inner: BaseLLMProvider = create_llm_provider(
        provider=creds.provider,
        api_key=creds.secret.get("api_key", ""),
        model_name=model,
        temperature=temperature,
        service_account_path=creds.service_account_path or "",
        **_provider_kwargs(creds),
    )
    usage_cb = make_usage_callback(
        tenant_id=tenant_id,
        user_id=user_id,
        app_id="",
        owner_type="llm_assist",
        owner_id=None,
        subsystem="admin_assist",
        default_call_purpose=call_purpose,
    )
    return LoggingLLMWrapper(inner=inner, usage_callback=usage_cb)


async def run_generate_prompt(
    *,
    creds: ResolvedCredentials,
    model: str,
    prompt_type: str,
    user_idea: str,
    tenant_id: uuid.UUID,
    user_id: Optional[uuid.UUID],
) -> str:
    """Generate a production-grade prompt for the given task type.

    Mirrors the legacy client-side prompt-generator pipeline.
    """
    llm = _build_logging_llm(
        creds=creds,
        model=model,
        tenant_id=tenant_id,
        user_id=user_id,
        call_purpose="assist_generate_prompt",
    )
    system_prompt = _PROMPT_GENERATOR_SYSTEM_PROMPT.format(
        prompt_type=prompt_type, user_idea=user_idea
    )
    # Use generate() — output is free-form text.
    result = await llm.generate(prompt=user_idea, system_prompt=system_prompt)
    if not isinstance(result, str):
        result = str(result)
    return result.strip()


async def run_generate_schema(
    *,
    creds: ResolvedCredentials,
    model: str,
    prompt_type: str,
    user_idea: str,
    tenant_id: uuid.UUID,
    user_id: Optional[uuid.UUID],
) -> dict:
    """Generate a JSON Schema describing the desired output."""
    llm = _build_logging_llm(
        creds=creds,
        model=model,
        tenant_id=tenant_id,
        user_id=user_id,
        call_purpose="assist_generate_schema",
    )
    system_prompt = _SCHEMA_GENERATOR_SYSTEM_PROMPT.format(
        prompt_type=prompt_type, user_idea=user_idea
    )
    raw = await llm.generate_json(
        prompt=user_idea,
        system_prompt=system_prompt,
        json_schema=_SCHEMA_META_SCHEMA,
    )
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Model returned non-JSON schema: {exc}") from exc
    if not isinstance(raw, dict):
        raise ValueError("Schema generator must return a JSON object")
    return raw


async def run_extract_structured(
    *,
    creds: ResolvedCredentials,
    model: str,
    body,
    tenant_id: uuid.UUID,
    user_id: Optional[uuid.UUID],
):
    """Run structured extraction in ``freeform`` or ``schema`` mode.

    ``body`` is the ``ExtractStructuredRequest`` instance (importing it would
    create a cycle through routes/schemas, so we keep it duck-typed).
    """
    from app.schemas.llm_assist import ExtractStructuredResponse

    llm = _build_logging_llm(
        creds=creds,
        model=model,
        tenant_id=tenant_id,
        user_id=user_id,
        call_purpose="assist_extract_structured",
    )

    input_source = body.input_source
    has_audio = input_source in ("audio", "both") and (body.audio_base64 or "").strip()
    audio_bytes: bytes | None = None
    mime_type = body.audio_mime_type or "audio/mpeg"
    if has_audio:
        try:
            audio_bytes = base64.b64decode(body.audio_base64 or "")
        except (ValueError, TypeError) as exc:
            return ExtractStructuredResponse(
                result={},
                status="failed",
                error=f"audioBase64 is not valid base64: {exc}",
            )

    transcript_text = (body.transcript or "").strip()
    prompt_text = body.prompt
    if transcript_text and input_source != "audio":
        prompt_text = f"{body.prompt}\n\nTRANSCRIPT:\n{transcript_text}"

    try:
        if body.prompt_type == "freeform":
            if audio_bytes is not None:
                # Audio-capable providers expose generate_with_audio without a
                # forced JSON schema — pass json_schema=None.
                result = await llm.generate_with_audio(
                    prompt=prompt_text,
                    audio_bytes=audio_bytes,
                    mime_type=mime_type,
                    json_schema=None,
                )
            else:
                result = await llm.generate(prompt=prompt_text)
            payload = {"text": result if isinstance(result, str) else str(result)}
        else:  # "schema"
            # In schema mode the caller-provided prompt already declares the
            # schema or output expectations; let the provider's generate_json
            # path enforce structured output. We do not own a meta-schema here.
            if audio_bytes is not None:
                result = await llm.generate_with_audio(
                    prompt=prompt_text,
                    audio_bytes=audio_bytes,
                    mime_type=mime_type,
                    json_schema=None,
                )
            else:
                result = await llm.generate_json(
                    prompt=prompt_text, json_schema=None
                )
            if isinstance(result, str):
                try:
                    result = json.loads(result)
                except json.JSONDecodeError:
                    return ExtractStructuredResponse(
                        result={"text": result},
                        status="completed",
                        error=None,
                    )
            payload = result if isinstance(result, dict) else {"value": result}
        return ExtractStructuredResponse(result=payload, status="completed", error=None)
    except (ValueError, RuntimeError, TimeoutError) as exc:
        logger.warning("llm_assist extract failed: %s", exc)
        return ExtractStructuredResponse(
            result={}, status="failed", error=str(exc)[:500]
        )
