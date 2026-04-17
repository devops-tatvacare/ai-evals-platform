"""Structured-output entity recognition before the Sherlock tool loop."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.services.evaluators.llm_base import create_llm_provider
from app.services.evaluators.settings_helper import get_llm_settings_from_db
from app.services.report_builder.scratchpad_state import build_resolved_entity_context

_CARRY_FORWARD_REFERENCES = (
    'that',
    'this',
    'it',
    'those',
    'these',
    'same',
    'latest',
    'previous',
    'above',
    'below',
)

_ENTITY_RECOGNITION_SYSTEM_PROMPT = """You classify whether a user question is about analytics in the current application.

Rules:
- Return JSON only.
- is_platform_query=true when the question is about the current application's runs, evaluations, trends, logs, rules, metrics, threads, reports, analytics, or evidence.
- is_platform_query=false for general knowledge, personal chat, creative writing, web search, coding help unrelated to the current app, or questions not about the app's data.
- needs_resolution=true when the question is vague, refers to entities by partial name/ID, or needs schema/data lookup before analysis.
- Only emit entity types from the provided registry.
- Keep entities concise and preserve the user's original text where possible.
"""


class RecognizedEntity(BaseModel):
    text: str
    type: str
    confidence: float = Field(ge=0, le=1)


class EntityRecognitionResult(BaseModel):
    entities: list[RecognizedEntity] = Field(default_factory=list)
    is_platform_query: bool = True
    needs_resolution: bool = False
    out_of_scope_reason: str | None = None


async def recognize_entities(
    *,
    question: str,
    scratchpad: dict[str, Any] | None,
    entity_registry: list[dict[str, Any]],
    provider: str,
    model: str,
    tenant_id: str,
    user_id: str,
) -> EntityRecognitionResult:
    llm = await _create_entity_recognition_provider(
        provider=provider,
        model=model,
        tenant_id=tenant_id,
        user_id=user_id,
    )
    payload = await llm.generate_json(
        prompt=_build_entity_recognition_prompt(
            question=question,
            scratchpad=scratchpad,
            entity_registry=entity_registry,
        ),
        system_prompt=_ENTITY_RECOGNITION_SYSTEM_PROMPT,
        json_schema=EntityRecognitionResult.model_json_schema(),
    )
    result = _filter_to_registered_types(
        EntityRecognitionResult.model_validate(payload),
        entity_registry=entity_registry,
    )
    return _apply_entity_carry_forward(
        question=question,
        scratchpad=scratchpad,
        entity_registry=entity_registry,
        result=result,
    )


def render_entity_recognition_context(result: EntityRecognitionResult) -> str:
    lines: list[str] = []
    if not result.is_platform_query:
        lines.extend([
            'Scope signal for this question:',
            '- This turn is out of scope for app analytics.',
            '- Reply in Sherlock\'s voice.',
            '- For greetings or light banter, keep it warm and brief, then steer back to the app.',
            '- For other out-of-scope asks, refuse briefly, do not answer the topic itself, and redirect to app analytics.',
            '- Do not use tools on this turn.',
        ])
        if result.out_of_scope_reason:
            lines.append(f'- Classifier note: {result.out_of_scope_reason}')
    if result.entities:
        lines.append('Recognized entities for this question:')
    else:
        return '\n'.join(lines)
    for entity in result.entities:
        lines.append(f"- {entity.type}: {entity.text} ({entity.confidence:.2f})")
    if result.needs_resolution:
        lines.append('- Resolve fuzzy entities with tools before analytics.')
    return '\n'.join(lines)


async def _create_entity_recognition_provider(
    *,
    provider: str,
    model: str,
    tenant_id: str,
    user_id: str,
):
    creds = await get_llm_settings_from_db(
        tenant_id=tenant_id,
        user_id=user_id,
        provider_override=provider,
        auth_intent='interactive',
    )
    return create_llm_provider(
        provider=provider,
        api_key=creds.get('api_key', ''),
        model_name=model,
        service_account_path=creds.get('service_account_path', ''),
        azure_endpoint=creds.get('azure_endpoint', ''),
        api_version=creds.get('api_version', '2025-03-01-preview'),
        temperature=0,
    )


def _build_entity_recognition_prompt(
    *,
    question: str,
    scratchpad: dict[str, Any] | None,
    entity_registry: list[dict[str, Any]],
) -> str:
    registry_lines = []
    for item in entity_registry:
        examples = ', '.join(str(example) for example in item.get('examples', [])[:5] if str(example).strip())
        description = str(item.get('description', '')).strip()
        line = f"- {item.get('name')}: {description or 'No description'}"
        if examples:
            line += f" Examples: {examples}"
        registry_lines.append(line)

    scratchpad_context = build_resolved_entity_context(scratchpad) or 'No prior resolved entities.'
    registry_text = '\n'.join(registry_lines) if registry_lines else '- none'
    return (
        f"Question:\n{question.strip()}\n\n"
        f"Prior session context:\n{scratchpad_context}\n\n"
        f"Entity type registry:\n{registry_text}\n\n"
        "Extract typed entities, decide if the question is about the current application's analytics/data, "
        "and mark needs_resolution when the agent should discover schema or exact values first."
    )


def _apply_entity_carry_forward(
    *,
    question: str,
    scratchpad: dict[str, Any] | None,
    entity_registry: list[dict[str, Any]],
    result: EntityRecognitionResult,
) -> EntityRecognitionResult:
    if not _should_carry_forward(question):
        return result
    if not isinstance(scratchpad, dict):
        return result

    allowed_types = {
        str(item.get('name', '')).strip().lower()
        for item in entity_registry
        if str(item.get('name', '')).strip()
    }
    existing_types = {entity.type.lower() for entity in result.entities}
    resolved_entities = scratchpad.get('resolved_entities', {})
    if not isinstance(resolved_entities, dict):
        return result

    carried_entities = list(result.entities)
    for entity_type, payload in resolved_entities.items():
        normalized_type = str(entity_type).strip().lower()
        if not normalized_type or normalized_type in existing_types or normalized_type not in allowed_types:
            continue
        if not isinstance(payload, dict):
            continue
        matches = payload.get('matches', [])
        if not isinstance(matches, list) or not matches:
            continue
        first_match = matches[0]
        if not isinstance(first_match, dict):
            continue
        value = first_match.get('value')
        if value in (None, ''):
            continue
        carried_entities.append(
            RecognizedEntity(
                text=str(value),
                type=str(entity_type),
                confidence=0.99,
            )
        )

    if len(carried_entities) == len(result.entities):
        return result
    return EntityRecognitionResult(
        entities=carried_entities,
        is_platform_query=result.is_platform_query,
        needs_resolution=result.needs_resolution,
        out_of_scope_reason=result.out_of_scope_reason,
    )


def _filter_to_registered_types(
    result: EntityRecognitionResult,
    *,
    entity_registry: list[dict[str, Any]],
) -> EntityRecognitionResult:
    allowed_types = {
        str(item.get('name', '')).strip().lower()
        for item in entity_registry
        if str(item.get('name', '')).strip()
    }
    if not allowed_types:
        return EntityRecognitionResult(
            entities=[],
            is_platform_query=result.is_platform_query,
            needs_resolution=result.needs_resolution,
            out_of_scope_reason=result.out_of_scope_reason,
        )

    filtered_entities = [
        entity
        for entity in result.entities
        if entity.type.strip().lower() in allowed_types
    ]
    if len(filtered_entities) == len(result.entities):
        return result
    return EntityRecognitionResult(
        entities=filtered_entities,
        is_platform_query=result.is_platform_query,
        needs_resolution=result.needs_resolution,
        out_of_scope_reason=result.out_of_scope_reason,
    )


def _should_carry_forward(question: str) -> bool:
    normalized = f" {question.lower().strip()} "
    return any(f' {token} ' in normalized for token in _CARRY_FORWARD_REFERENCES)
