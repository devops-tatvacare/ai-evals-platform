"""All LLM provider env fallbacks must be gone — credentials are per-tenant only.

The system-tenant Gemini SA fallback was dead code (no caller ever resolved LLM
credentials under SYSTEM_TENANT_ID); per-tenant SA upload via the UI replaced it,
so the env var is removed entirely. This guard catches any attempt to reintroduce
a provider credential as a ``Settings`` field.
"""
REMOVED = [
    "GEMINI_API_KEY", "GEMINI_AUTH_METHOD", "GEMINI_MODEL", "OPENAI_API_KEY",
    "OPENAI_MODEL", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_API_VERSION", "AZURE_OPENAI_MODEL", "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL", "DEFAULT_LLM_PROVIDER", "EVAL_TEMPERATURE",
    "SHERLOCK_SUPERVISOR_MODEL", "SHERLOCK_SPECIALIST_MODEL",
    "GEMINI_SERVICE_ACCOUNT_PATH",
]
KEPT = ["LLM_CREDENTIAL_KEY", "ORCHESTRATION_CONNECTION_KEY"]


def test_removed_vars_absent():
    from app.config import Settings
    fields = set(Settings.model_fields.keys())
    for name in REMOVED:
        assert name not in fields, f"{name} should have been removed"


def test_kept_vars_present():
    from app.config import Settings
    fields = set(Settings.model_fields.keys())
    for name in KEPT:
        assert name in fields, f"{name} must remain"
