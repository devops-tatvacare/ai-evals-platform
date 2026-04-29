#!/bin/sh
# Strict mode: any non-zero exit aborts boot. Without this, a failing
# alembic upgrade or service-account decode would silently fall through
# to uvicorn and serve traffic with broken state.
set -e

# Decode Gemini service account from env var (base64-encoded JSON) if provided.
# This avoids mounting a JSON file on Azure App Service.
if [ -n "$GEMINI_SERVICE_ACCOUNT_JSON" ]; then
    echo "$GEMINI_SERVICE_ACCOUNT_JSON" | base64 -d > /app/service-account.json
    export GEMINI_SERVICE_ACCOUNT_PATH=/app/service-account.json
fi

# Apply pending Alembic migrations before serving traffic. Defaults to "true"
# so the image just works without per-environment env-var changes.
#
# When multiple containers boot together, serialize the migration step with a
# Postgres advisory lock before calling `alembic upgrade head`. That avoids the
# `public.alembic_version` DDL deadlock path and keeps the legacy
# `varchar(32)` -> `varchar(255)` preflight safe on older DBs.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    echo "[entrypoint] locked alembic upgrade head"
    python -m app.services.migration.run_alembic_with_lock
fi

if [ "$#" -gt 0 ]; then
    exec "$@"
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8721
