"""Evaluator draft generation — LLM-powered schema extraction from prompts."""
import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)

# The system prompt for draft generation
DRAFT_SYSTEM_PROMPT = """You are an evaluator schema designer. Given an evaluation prompt, extract the output fields that the evaluator should produce.

For each field, determine:
- key: snake_case identifier
- type: "number" | "boolean" | "text" | "enum"
- description: human-readable label
- role: "metric" (quantitative scores), "detail" (qualitative assessments), or "reasoning" (internal chain-of-thought)
- isMainMetric: true for exactly ONE field that best represents the overall evaluation outcome
- thresholds: for number fields, suggest {"green": N, "yellow": N} if the prompt implies pass/fail criteria
- allowedValues: for enum fields, list the possible values

Return a JSON object with:
{
  "outputFields": [...],
  "warnings": ["any concerns about the prompt"]
}"""


async def generate_evaluator_draft(
    *,
    prompt: str,
    app_id: str,
    tenant_id: str,
    user_id: str,
    provider: str,
    model: str,
    rule_catalog: list[dict] | None = None,
    job_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Generate evaluator draft from a prompt using the supplied LLM provider/model.

    Returns:
        {
            "outputFields": list of field definitions,
            "matchedRuleIds": list of rule IDs from the catalog,
            "warnings": list of warning strings,
        }
    """
    from app.database import async_session
    from app.services.evaluators.llm_base import create_llm_provider
    from app.services.llm_credentials import (
        ProviderNotConfiguredError,
        resolve_credentials,
    )

    output_fields: list[dict] = []
    matched_rule_ids: list[str] = []
    warnings: list[str] = []

    if not provider or not model:
        warnings.append(
            "Missing provider/model for evaluator draft. Configure an LLM in AI Settings and select a model."
        )
        return {"outputFields": [], "matchedRuleIds": [], "warnings": warnings}

    try:
        async with async_session() as db:
            try:
                creds = await resolve_credentials(db, tenant_id, provider)
            except ProviderNotConfiguredError as exc:
                warnings.append(str(exc))
                return {"outputFields": [], "matchedRuleIds": [], "warnings": warnings}

        provider_kwargs: dict[str, Any] = {}
        if creds.provider == "azure_openai":
            provider_kwargs["azure_endpoint"] = creds.extra_config.get("base_url") or ""
            provider_kwargs["api_version"] = creds.extra_config.get(
                "api_version", "2025-03-01-preview"
            )

        inner = create_llm_provider(
            provider=creds.provider,
            model_name=model,
            api_key=creds.secret.get("api_key", ""),
            service_account_path=creds.service_account_path or "",
            **provider_kwargs,
        )

        # Wrap with LoggingLLMWrapper so the draft call records an analytics.fact_llm_generation
        # row. owner_type='job' (§7.4) with owner_id = the caller's job_id.
        # Legacy callers without a job_id fall through to the raw provider.
        if job_id is not None:
            from app.services.evaluators.llm_base import LoggingLLMWrapper
            from app.services.evaluators.runner_utils import make_usage_callback

            try:
                tenant_uuid = uuid.UUID(tenant_id) if isinstance(tenant_id, str) else tenant_id
                user_uuid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
            except (ValueError, TypeError):
                tenant_uuid = None
                user_uuid = None

            if tenant_uuid is not None:
                usage_cb = make_usage_callback(
                    tenant_id=tenant_uuid,
                    user_id=user_uuid,
                    app_id=app_id,
                    owner_type='job',
                    owner_id=job_id,
                    subsystem='evaluator_draft',
                )
                wrapped = LoggingLLMWrapper(inner, usage_callback=usage_cb)
                wrapped.set_call_purpose('draft')
                llm_client: Any = wrapped
            else:
                llm_client = inner
        else:
            llm_client = inner

        user_message = f"Generate output fields for this evaluation prompt:\n\n{prompt}"

        response = await llm_client.generate_json(
            prompt=user_message,
            system_prompt=DRAFT_SYSTEM_PROMPT,
        )

        if isinstance(response, dict):
            output_fields = response.get("outputFields", [])
            warnings.extend(response.get("warnings", []))

        # Auto-match rules from the catalog if provided
        if rule_catalog and output_fields:
            prompt_lower = prompt.lower()
            prompt_words = set(prompt_lower.split())
            for rule in rule_catalog:
                rule_text = (rule.get("rule_text", "") or "").lower()
                rule_id = rule.get("rule_id", "")
                # Simple keyword overlap heuristic
                if rule_id and rule_text:
                    keywords = set(rule_text.split())
                    overlap = keywords & prompt_words
                    if len(overlap) >= 3:
                        matched_rule_ids.append(rule_id)

    except Exception as e:
        logger.warning(f"Draft generation failed: {e}")
        warnings.append(f"Draft generation failed: {str(e)}")

    return {
        "outputFields": output_fields,
        "matchedRuleIds": matched_rule_ids,
        "warnings": warnings,
    }
