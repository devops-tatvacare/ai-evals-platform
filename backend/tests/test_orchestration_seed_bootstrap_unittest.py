"""Env→connection bootstrap + seed loader behaviour after the vendor-abstraction wipe."""
from __future__ import annotations

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import func, select

from app.constants import SYSTEM_TENANT_ID
from app.models.orchestration import Workflow
from app.models.provider_connection import ProviderConnection


@pytest.fixture(autouse=True)
def fernet_key(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.ORCHESTRATION_CONNECTION_KEY",
        Fernet.generate_key().decode(),
    )


def _set_bolna_env(monkeypatch):
    # api_key + base_url are the credential pair; from_phone is UI-supplied
    # (Phase 13 / Phase A) and no longer env-bootstrapped.
    monkeypatch.setattr("app.config.settings.BOLNA_API_KEY", "k")
    monkeypatch.setattr("app.config.settings.BOLNA_BASE_URL", "https://api.bolna.ai")


def _set_wati_env(monkeypatch):
    monkeypatch.setattr("app.config.settings.WATI_BASE_URL", "https://live-mt-server.wati.io")
    monkeypatch.setattr("app.config.settings.WATI_TENANT_ID", "12345")
    monkeypatch.setattr("app.config.settings.WATI_API_TOKEN", "tok")


def _clear_provider_env(monkeypatch):
    for var in (
        "BOLNA_API_KEY", "BOLNA_BASE_URL",
        "WATI_BASE_URL", "WATI_TENANT_ID", "WATI_API_TOKEN",
        "LSQ_BASE_URL", "LSQ_ACCESS_KEY", "LSQ_SECRET_KEY",
    ):
        monkeypatch.setattr(f"app.config.settings.{var}", "")


def _bootstrapped_names() -> tuple[str, ...]:
    from app.services.orchestration_seed import _bootstrapped_connection_name

    return tuple(
        _bootstrapped_connection_name(provider)
        for provider in ("bolna", "wati", "lsq")
    )


@pytest.mark.asyncio
async def test_bootstrap_inserts_when_env_set(db_session, monkeypatch):
    _set_bolna_env(monkeypatch)
    monkeypatch.setattr("app.config.settings.ORCHESTRATION_DEFAULT_APP_ID", "inside-sales")

    from app.services.orchestration_seed import _bootstrap_default_connections_from_env

    await _bootstrap_default_connections_from_env(db_session)

    row = await db_session.scalar(
        select(ProviderConnection).where(
            ProviderConnection.tenant_id == SYSTEM_TENANT_ID,
            ProviderConnection.provider == "bolna",
            ProviderConnection.app_id == "inside-sales",
        )
    )
    assert row is not None
    assert row.webhook_token is not None  # bolna supports webhooks


@pytest.mark.asyncio
async def test_bootstrap_is_idempotent(db_session, monkeypatch):
    _set_bolna_env(monkeypatch)
    monkeypatch.setattr("app.config.settings.ORCHESTRATION_DEFAULT_APP_ID", "inside-sales")

    from app.services.orchestration_seed import _bootstrap_default_connections_from_env

    await _bootstrap_default_connections_from_env(db_session)
    rows_before = (await db_session.execute(
        select(ProviderConnection).where(
            ProviderConnection.tenant_id == SYSTEM_TENANT_ID,
            ProviderConnection.provider == "bolna",
            ProviderConnection.app_id == "inside-sales",
        )
    )).scalars().all()

    await _bootstrap_default_connections_from_env(db_session)
    rows_after = (await db_session.execute(
        select(ProviderConnection).where(
            ProviderConnection.tenant_id == SYSTEM_TENANT_ID,
            ProviderConnection.provider == "bolna",
            ProviderConnection.app_id == "inside-sales",
        )
    )).scalars().all()
    assert len(rows_before) == len(rows_after) == 1


@pytest.mark.asyncio
async def test_bootstrap_skips_partial_bolna_env(db_session, monkeypatch):
    """api_key + base_url are both required for the env-bootstrapped row;
    partial env must not produce a half-configured row. (from_phone is
    UI-supplied per Phase A and excluded from this gate.)"""
    _clear_provider_env(monkeypatch)
    monkeypatch.setattr("app.config.settings.BOLNA_API_KEY", "k")
    # BOLNA_BASE_URL intentionally left blank.
    monkeypatch.setattr("app.config.settings.ORCHESTRATION_DEFAULT_APP_ID", "inside-sales")

    from app.services.orchestration_seed import _bootstrap_default_connections_from_env

    before = (await db_session.execute(
        select(ProviderConnection).where(
            ProviderConnection.tenant_id == SYSTEM_TENANT_ID,
            ProviderConnection.provider == "bolna",
            ProviderConnection.app_id == "inside-sales",
            ProviderConnection.name == "Default bolna (env-bootstrapped)",
        )
    )).scalars().all()

    await _bootstrap_default_connections_from_env(db_session)

    rows = (await db_session.execute(
        select(ProviderConnection).where(
            ProviderConnection.tenant_id == SYSTEM_TENANT_ID,
            ProviderConnection.provider == "bolna",
            ProviderConnection.app_id == "inside-sales",
            ProviderConnection.name == "Default bolna (env-bootstrapped)",
        )
    )).scalars().all()
    assert len(rows) == len(before)


@pytest.mark.asyncio
async def test_bootstrap_skips_provider_without_env(db_session, monkeypatch):
    _clear_provider_env(monkeypatch)
    monkeypatch.setattr("app.config.settings.ORCHESTRATION_DEFAULT_APP_ID", "inside-sales")

    from app.services.orchestration_seed import _bootstrap_default_connections_from_env

    names = _bootstrapped_names()
    before = (await db_session.execute(
        select(ProviderConnection).where(
            ProviderConnection.tenant_id == SYSTEM_TENANT_ID,
            ProviderConnection.app_id == "inside-sales",
            ProviderConnection.name.in_(names),
        )
    )).scalars().all()

    await _bootstrap_default_connections_from_env(db_session)
    rows = (await db_session.execute(
        select(ProviderConnection).where(
            ProviderConnection.tenant_id == SYSTEM_TENANT_ID,
            ProviderConnection.app_id == "inside-sales",
            ProviderConnection.name.in_(names),
        )
    )).scalars().all()
    assert len(rows) == len(before)


@pytest.mark.asyncio
async def test_seed_does_not_install_any_workflow(db_session, monkeypatch):
    """Vendor-abstraction P1 wiped the seeded MQL Concierge / DM2 workflows;
    the seeder no longer installs any workflow fixture."""
    _set_bolna_env(monkeypatch)
    _set_wati_env(monkeypatch)
    monkeypatch.setattr("app.config.settings.ORCHESTRATION_DEFAULT_APP_ID", "inside-sales")

    from app.services.orchestration_seed import seed_orchestration_defaults

    await seed_orchestration_defaults(db_session)

    count = await db_session.scalar(
        select(func.count()).select_from(Workflow).where(
            Workflow.tenant_id == SYSTEM_TENANT_ID,
        )
    )
    assert count == 0
