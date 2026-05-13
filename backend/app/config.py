"""Application configuration from environment variables."""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """All config comes from env vars or .env.backend file."""

    DATABASE_URL: str = "postgresql+asyncpg://evals_user:evals_pass@localhost:5432/ai_evals_platform"
    ANALYTICS_DATABASE_URL: str = ""  # Falls back to DATABASE_URL if empty
    FILE_STORAGE_TYPE: str = "local"  # "local" or "azure_blob"
    FILE_STORAGE_PATH: str = "./backend/uploads"
    API_PORT: int = 8721
    CORS_ORIGINS: str = "http://localhost:5173"

    # Azure Blob (production only)
    AZURE_STORAGE_CONNECTION_STRING: str = ""
    AZURE_STORAGE_CONTAINER: str = "evals-files"

    # LLM providers (for Phase 3 batch evaluation jobs)
    GEMINI_API_KEY: str = ""
    GEMINI_AUTH_METHOD: str = "api_key"  # "api_key" or "service_account"
    GEMINI_SERVICE_ACCOUNT_PATH: str = ""
    GEMINI_MODEL: str = ""
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = ""
    AZURE_OPENAI_API_KEY: str = ""
    AZURE_OPENAI_ENDPOINT: str = ""
    AZURE_OPENAI_API_VERSION: str = "2025-03-01-preview"
    AZURE_OPENAI_MODEL: str = ""
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = ""
    DEFAULT_LLM_PROVIDER: str = "gemini"
    EVAL_TEMPERATURE: float = 0.1

    # Kaira API (for live adversarial testing)
    KAIRA_API_URL: str = ""
    KAIRA_AUTH_TOKEN: str = ""
    KAIRA_TEST_USER_ID: str = ""

    # Frontend URL (used for invite link URLs — must point to where users access the app)
    APP_BASE_URL: str = "http://localhost:5173"
    # Internal frontend URL used by backend-driven browser rendering (e.g. PDF export).
    PDF_RENDER_BASE_URL: str = ""

    # Auth / JWT
    JWT_SECRET: str = ""  # Required — validated on startup
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Bootstrap admin (used only when no users exist in DB)
    ADMIN_EMAIL: str = ""
    ADMIN_PASSWORD: str = ""
    ADMIN_TENANT_NAME: str = ""
    ADMIN_TENANT_ALLOWED_DOMAINS: str = ""  # Comma-separated, e.g. "@tatvacare.in,@tatva.com"

    # Adversarial test settings
    ADVERSARIAL_MAX_TURNS: int = 10
    ADVERSARIAL_TURN_DELAY: float = 1.5
    ADVERSARIAL_CASE_DELAY: float = 3.0

    # LeadSquared API (Inside Sales)
    LSQ_BASE_URL: str = ""
    LSQ_ACCESS_KEY: str = ""
    LSQ_SECRET_KEY: str = ""

    # ─── Orchestration integrations ────────────────────────────────────
    WATI_BASE_URL: str = ""           # https://live-mt-server.wati.io
    WATI_TENANT_ID: str = ""          # numeric WATI tenant ID
    WATI_API_TOKEN: str = ""
    WATI_WEBHOOK_SECRET: str = ""

    BOLNA_BASE_URL: str = "https://api.bolna.ai"
    BOLNA_API_KEY: str = ""
    BOLNA_WEBHOOK_SECRET: str = ""

    SMS_PROVIDER: str = ""            # 'gupshup' | 'twilio' | ''
    SMS_API_KEY: str = ""
    SMS_BASE_URL: str = ""

    # Orchestration webhooks — public routes guarded by URL-segment secret
    LSQ_WEBHOOK_SECRET: str = ""
    ORCHESTRATION_EVENT_WEBHOOK_SECRET: str = ""
    # v1 single tenant + app per provider; multi-tenant secret→tenant lookup is v2.
    ORCHESTRATION_DEFAULT_TENANT_ID: str = "00000000-0000-0000-0000-000000000001"
    ORCHESTRATION_DEFAULT_APP_ID: str = "inside-sales"

    # Process-level Fernet key encrypting orchestration.provider_connections
    # config_encrypted blobs. Required — validated on startup. Loss = all
    # tenant credentials become unreadable; back up like JWT_SECRET.
    ORCHESTRATION_CONNECTION_KEY: str = ""

    # Upload limits
    MAX_UPLOAD_SIZE_MB: int = 100  # enforced in file upload route
    ALLOWED_UPLOAD_MIMES: str = (
        "audio/wav,audio/mpeg,audio/mp3,audio/webm,audio/x-wav,audio/x-m4a,"
        "audio/m4a,audio/mp4,audio/ogg,"
        "text/csv,text/plain,application/json,application/octet-stream"
    )

    # Auth rate limiting
    AUTH_RATE_LIMIT: str = "10/minute"  # login, signup, refresh
    COST_PRICING_REFRESH_RATE_LIMIT: str = "5/minute;50/hour"

    # Background job worker
    JOB_MAX_CONCURRENT: int = 12
    JOB_POLL_INTERVAL_SECONDS: float = 1.0
    JOB_HEARTBEAT_INTERVAL_SECONDS: float = 15.0
    JOB_LEASE_SECONDS: int = 60
    JOB_STALE_TIMEOUT_MINUTES: int = 30
    JOB_MAX_ATTEMPTS: int = 3
    JOB_RETRY_BASE_DELAY_SECONDS: int = 5
    JOB_RETRY_MAX_DELAY_SECONDS: int = 120
    JOB_TENANT_MAX_CONCURRENT: int = 8
    JOB_APP_MAX_CONCURRENT: int = 5
    JOB_USER_MAX_CONCURRENT: int = 3
    JOB_INTERACTIVE_MAX_CONCURRENT: int = 0
    JOB_STANDARD_MAX_CONCURRENT: int = 0
    JOB_BULK_MAX_CONCURRENT: int = 4
    JOB_ANALYTICS_MAX_CONCURRENT: int = 1
    JOB_CLAIM_WINDOW_MULTIPLIER: int = 10
    JOB_CLAIM_WINDOW_MAX: int = 100
    JOB_RUN_EMBEDDED_WORKER: bool = True

    # Scheduler engine (shares the worker process; set to 0 to disable)
    SCHEDULER_TICK_INTERVAL_SECONDS: int = 60

    # Logging (used by app/logging_config.py)
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"  # "json" | "console"

    # Phase 3 of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.
    # When True, inside_sales calls sync projects fact_lead_activity rows via
    # ``MirrorToFactMapper`` instead of the legacy ``build_call_activity_fact_row``
    # Python function. Default False ships dormant; turn on for 24h dev
    # observation before Phase 4 backfill. Phase 7 removes the flag and the
    # legacy path together.
    INSIDE_SALES_FACT_SAME_TX: bool = False

    class Config:
        env_file = ".env.backend"
        env_file_encoding = "utf-8"


settings = Settings()
