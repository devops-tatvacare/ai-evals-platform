"""Service layer for orchestration HTTP routes.

Each module exposes pure async functions that accept a session + auth-derived
``tenant_id`` / ``app_id`` / ``user_id``. Route handlers stay thin: parse
request, call service, raise HTTPException on the typed error classes here.
"""
