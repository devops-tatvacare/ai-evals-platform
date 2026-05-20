"""Trigram GIN indexes for chat history search (title + message content).

Backs ILIKE search in GET /api/chat/sessions?q= over chat_sessions.title and
chat_messages.content so title and conversation-text hits both stay fast.
"""
from alembic import op

revision = "0069"
down_revision = "0068"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_sessions_title_trgm "
        "ON platform.chat_sessions USING gin (title gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_messages_content_trgm "
        "ON platform.chat_messages USING gin (content gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS platform.idx_chat_messages_content_trgm")
    op.execute("DROP INDEX IF EXISTS platform.idx_chat_sessions_title_trgm")
