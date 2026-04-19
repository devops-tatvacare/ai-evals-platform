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
    rule_catalog: list[dict] | None = None,
    job_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Generate evaluator draft from a prompt using the user's LLM settings.

    Returns:
        {
            "outputFields": list of field definitions,
            "matchedRuleIds": list of rule IDs from the catalog,
            "warnings": list of warning strings,
        }
    """
    from app.services.evaluators.settings_helper import get_llm_settings_from_db
    from app.services.evaluators.llm_base import create_llm_provider

    output_fields: list[dict] = []
    matched_rule_ids: list[str] = []
    warnings: list[str] = []

    try:
        # Resolve LLM credentials from the user's saved settings
        db_settings = await get_llm_settings_from_db(
            tenant_id=tenant_id,
            user_id=user_id,
            auth_intent="managed_job",
        )

        provider_name = db_settings.get("provider", "gemini")
        model_name = db_settings.get("selected_model", "")
        api_key = db_settings.get("api_key", "")

        if not model_name:
            warnings.append("No LLM model configured. Please select a model in Settings.")
            return {"outputFields": [], "matchedRuleIds": [], "warnings": warnings}

        if not api_key and not db_settings.get("service_account_path"):
            warnings.append("No LLM credentials configured. Please add API keys in Settings.")
            return {"outputFields": [], "matchedRuleIds": [], "warnings": warnings}

        inner = create_llm_provider(
            provider=provider_name,
            model_name=model_name,
            api_key=api_key,
            service_account_path=db_settings.get("service_account_path", ""),
            azure_endpoint=db_settings.get("azure_endpoint", ""),
            api_version=db_settings.get("api_version", ""),
        )

        # Wrap with LoggingLLMWrapper so the draft call records an llm_usage
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
                provider: Any = wrapped
            else:
                provider = inner
        else:
            provider = inner

        user_message = f"Generate output fields for this evaluation prompt:\n\n{prompt}"

        response = await provider.generate_json(
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
