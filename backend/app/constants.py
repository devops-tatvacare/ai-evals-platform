"""Application-wide constants."""
import uuid

# Well-known UUIDs for system seed data (prompts, schemas, global evaluators).
# These records are visible to all tenants as read-only defaults.
SYSTEM_TENANT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
SYSTEM_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")

# Chat session source marker reserved for Sherlock runtime sessions.
SHERLOCK_CHAT_SOURCE = "sherlock"
