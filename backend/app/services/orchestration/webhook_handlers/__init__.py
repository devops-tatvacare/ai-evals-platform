"""Inbound webhook event handlers for orchestration providers.

Each module exposes one async ``handle_<provider>_event(db, *, tenant_id, app_id, payload)``
that parses the provider payload, matches the originating action row, writes a
follow-up action row (idempotent), and flips parked recipient states when applicable.
"""
