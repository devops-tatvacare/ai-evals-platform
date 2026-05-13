"""Serialize Alembic upgrades across concurrently booting containers.

This helper acquires a Postgres advisory lock, widens the legacy
``public.alembic_version.version_num`` column when needed, then runs
``alembic upgrade head``. The lock keeps backend + worker boots from
deadlocking on ``alembic_version`` while Roadmap 01's long-form revision
identifiers are introduced.

The lock connection runs in **AUTOCOMMIT** mode. asyncpg autobegins a
transaction on every execute by default — and ``pg_advisory_lock`` is an
execute. If a second caller is blocked waiting for the lock while sitting
inside that autobegun transaction, the first caller's migration cannot
run ``CREATE INDEX CONCURRENTLY``: Postgres makes CONCURRENTLY wait for
every transaction older than the index's, and the loser's blocked
session holds a ``virtualxid`` that satisfies the "older transaction"
test. Both callers stall, and the only escape is ``pg_terminate_backend``
on the loser. AUTOCOMMIT eliminates the trap because the blocked
``pg_advisory_lock`` call no longer holds a virtualxid; advisory locks
are session-scoped (not tx-scoped), so the lock semantics survive the
change.

In docker-compose the dedicated ``migrate`` one-shot service is the only
caller — backend and worker run with ``RUN_MIGRATIONS=false`` and depend
on ``migrate: service_completed_successfully``. The AUTOCOMMIT change is
defense in depth for the Azure prod scenario where a rolling deploy can
briefly run two backend replicas concurrently.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from sqlalchemy import pool, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import settings

_ALEMBIC_LOCK_KEY = 827441901235
_TARGET_VERSION_NUM_LENGTH = 255
_PROJECT_ROOT = Path(__file__).resolve().parents[3]


async def _ensure_alembic_version_capacity(connection) -> None:
    """Widen ``alembic_version.version_num`` if it's still the legacy 32-char width.

    The connection is in AUTOCOMMIT mode (see ``_run_locked_upgrade``), so
    every ``execute`` commits independently — no explicit ``commit()``.
    """
    result = await connection.execute(
        text(
            """
            SELECT character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'alembic_version'
              AND column_name = 'version_num'
            """
        )
    )
    current_length = result.scalar_one_or_none()
    if current_length is None or current_length >= _TARGET_VERSION_NUM_LENGTH:
        return
    print(
        "[migrations] widening public.alembic_version.version_num "
        f"from varchar({current_length}) to varchar({_TARGET_VERSION_NUM_LENGTH})"
    )
    await connection.execute(
        text(
            "ALTER TABLE public.alembic_version "
            f"ALTER COLUMN version_num TYPE varchar({_TARGET_VERSION_NUM_LENGTH})"
        )
    )


async def _run_locked_upgrade() -> int:
    # ``isolation_level='AUTOCOMMIT'`` on the engine makes every connection
    # check-out start in autocommit mode — no autobegun tx around the
    # blocking ``pg_advisory_lock`` call. See module docstring for the full
    # CONCURRENTLY-deadlock reasoning.
    engine = create_async_engine(
        settings.DATABASE_URL,
        poolclass=pool.NullPool,
        isolation_level="AUTOCOMMIT",
    )
    try:
        async with engine.connect() as connection:
            print("[migrations] waiting for advisory lock")
            await connection.execute(
                text("SELECT pg_advisory_lock(:lock_key)"),
                {"lock_key": _ALEMBIC_LOCK_KEY},
            )
            print("[migrations] advisory lock acquired")
            try:
                await _ensure_alembic_version_capacity(connection)
                # Alembic opens its own engine/connection via env.py, so
                # the subprocess is unaffected by our AUTOCOMMIT setting
                # — migrations still run inside their normal transaction.
                process = await asyncio.create_subprocess_exec(
                    sys.executable,
                    "-m",
                    "alembic",
                    "upgrade",
                    "head",
                    cwd=str(_PROJECT_ROOT),
                )
                return await process.wait()
            finally:
                await connection.execute(
                    text("SELECT pg_advisory_unlock(:lock_key)"),
                    {"lock_key": _ALEMBIC_LOCK_KEY},
                )
                print("[migrations] advisory lock released")
    finally:
        await engine.dispose()


def main() -> int:
    return asyncio.run(_run_locked_upgrade())


if __name__ == "__main__":
    raise SystemExit(main())
