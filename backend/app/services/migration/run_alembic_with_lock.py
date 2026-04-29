"""Serialize Alembic upgrades across concurrently booting containers.

This helper acquires a Postgres advisory lock, widens the legacy
``public.alembic_version.version_num`` column when needed, then runs
``alembic upgrade head``. The lock keeps backend + worker boots from
deadlocking on ``alembic_version`` while Roadmap 01's long-form revision
identifiers are introduced.
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
    await connection.commit()


async def _run_locked_upgrade() -> int:
    engine = create_async_engine(settings.DATABASE_URL, poolclass=pool.NullPool)
    try:
        async with engine.connect() as connection:
            print("[migrations] waiting for advisory lock")
            await connection.execute(
                text("SELECT pg_advisory_lock(:lock_key)"),
                {"lock_key": _ALEMBIC_LOCK_KEY},
            )
            await connection.commit()
            print("[migrations] advisory lock acquired")
            try:
                await _ensure_alembic_version_capacity(connection)
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
                await connection.commit()
                print("[migrations] advisory lock released")
    finally:
        await engine.dispose()


def main() -> int:
    return asyncio.run(_run_locked_upgrade())


if __name__ == "__main__":
    raise SystemExit(main())
