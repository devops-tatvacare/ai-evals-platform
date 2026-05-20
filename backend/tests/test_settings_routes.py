"""Settings contract tests — Phase 1 data contracts + Phase 2 resolution."""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from sqlalchemy.dialects import postgresql
from pydantic import ValidationError

from app.models.application_setting import ApplicationSetting
from app.models.mixins.shareable import Visibility
from app.schemas.setting import SettingCreate, SettingResponse
from app.services.asset_policy import is_private_only_asset_key
from app.services.settings_upsert import build_setting_upsert_stmt


def test_setting_create_accepts_visibility_for_shared_contract_rows():
    payload = SettingCreate(
        appId="kaira-bot",
        key="adversarial-config",
        value={"version": 1},
        visibility="shared",
    )

    assert payload.visibility == Visibility.SHARED
    assert payload.model_dump(by_alias=True)["visibility"] == Visibility.SHARED


def test_setting_create_rejects_legacy_app_visibility_input():
    try:
        SettingCreate(
            appId="kaira-bot",
            key="adversarial-config",
            value={"version": 1},
            visibility="app",
        )
    except ValidationError:
        return

    raise AssertionError("SettingCreate should reject legacy app visibility input")


def test_setting_response_serializes_share_metadata_in_camel_case():
    row = ApplicationSetting(
        id=10,
        app_id="kaira-bot",
        key="rule-catalog",
        value={"rules": []},
        visibility=Visibility.SHARED,
        updated_by=uuid.uuid4(),
        shared_by=uuid.uuid4(),
        shared_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
    )

    payload = SettingResponse.model_validate(row).model_dump(by_alias=True, mode="json")

    assert payload["visibility"] == "shared"
    assert "updatedBy" in payload
    assert "sharedBy" in payload
    assert "sharedAt" in payload


def test_setting_model_exposes_private_and_shared_unique_indexes():
    index_names = {index.name for index in ApplicationSetting.__table__.indexes}

    assert "uq_application_settings_private_scope" in index_names
    assert "uq_application_settings_shared_scope" in index_names


def test_settings_asset_policy_no_private_only_keys_after_phase3():
    # Phase 3 retired llm-settings; the policy no longer pins any setting key
    # as private-only. rule-catalog stays freely shareable.
    assert is_private_only_asset_key("settings", "llm-settings") is False
    assert is_private_only_asset_key("settings", "rule-catalog") is False


# ─── Phase 2: Settings resolution + access tests ────────────────

from app.services.access_control import can_access


def _make_user(tenant_id, user_id, app_access=frozenset()):
    return SimpleNamespace(
        tenant_id=tenant_id,
        user_id=user_id,
        app_access=frozenset(app_access),
    )


def _make_setting(tenant_id, user_id, app_id, key, visibility):
    return ApplicationSetting(
        id=99,
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        key=key,
        value={},
        visibility=visibility,
        updated_at=datetime.now(timezone.utc),
    )


def test_app_member_can_read_shared_setting():
    """Any user with app access can read a shared setting."""
    tid = uuid.uuid4()
    owner = uuid.uuid4()
    reader = uuid.uuid4()
    user = _make_user(tid, reader, app_access=frozenset({"kaira-bot"}))
    asset = _make_setting(tid, owner, "kaira-bot", "adversarial-config", Visibility.SHARED)

    assert can_access(user, asset, "read") is True


def test_app_member_cannot_read_other_users_private_setting():
    """A user cannot read another user's private setting."""
    tid = uuid.uuid4()
    owner = uuid.uuid4()
    reader = uuid.uuid4()
    user = _make_user(tid, reader, app_access=frozenset({"kaira-bot"}))
    asset = _make_setting(tid, owner, "kaira-bot", "my-config", Visibility.PRIVATE)

    assert can_access(user, asset, "read") is False


def test_app_member_cannot_edit_shared_setting_unless_owner():
    """Only the owner of a shared setting can edit it (at this access-control level)."""
    tid = uuid.uuid4()
    owner = uuid.uuid4()
    other = uuid.uuid4()
    user = _make_user(tid, other, app_access=frozenset({"kaira-bot"}))
    asset = _make_setting(tid, owner, "kaira-bot", "rule-catalog", Visibility.SHARED)

    assert can_access(user, asset, "edit") is False


def test_shared_upsert_targets_canonical_shared_scope_not_owner_scope():
    stmt = build_setting_upsert_stmt(
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        app_id="kaira-bot",
        key="rule-catalog",
        value={"rules": []},
        visibility=Visibility.SHARED,
        updated_by=uuid.uuid4(),
        forked_from=None,
        shared_by=uuid.uuid4(),
    )

    sql = str(stmt.compile(dialect=postgresql.dialect()))

    assert 'ON CONFLICT (tenant_id, app_id, key, visibility)' in sql
    assert "WHERE visibility = 'SHARED'" in sql


def test_private_upsert_targets_private_scope_including_owner():
    stmt = build_setting_upsert_stmt(
        tenant_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        app_id="voice-rx",
        key="rule-catalog",
        value={"rules": []},
        visibility=Visibility.PRIVATE,
        updated_by=uuid.uuid4(),
        forked_from=None,
    )

    sql = str(stmt.compile(dialect=postgresql.dialect()))

    assert 'ON CONFLICT (tenant_id, app_id, key, user_id, visibility)' in sql
    assert "WHERE visibility = 'PRIVATE'" in sql
