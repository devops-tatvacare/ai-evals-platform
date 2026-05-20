"""Phase 1 shared-setting access rules for rule catalogs and LLM settings."""

import uuid
from types import SimpleNamespace

from app.models.mixins.shareable import Visibility
from app.models.application_setting import ApplicationSetting
from app.services.access_control import can_access
from app.services.evaluators.rules_service import _extract_rules


def _user(*, tenant_id: uuid.UUID, user_id: uuid.UUID, app_access: tuple[str, ...]) -> SimpleNamespace:
    return SimpleNamespace(
        tenant_id=tenant_id,
        user_id=user_id,
        app_access=frozenset(app_access),
    )


def test_rule_catalog_shared_setting_can_be_created_for_app_scope():
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    asset = ApplicationSetting(
        app_id="kaira-bot",
        key="rule-catalog",
        value={"rules": []},
        tenant_id=tenant_id,
        user_id=user_id,
        visibility=Visibility.SHARED,
    )
    user = _user(tenant_id=tenant_id, user_id=user_id, app_access=("kaira-bot",))

    assert can_access(user, asset, "create") is True


# Phase 3 retired the llm-settings private-only pin. The legacy
# test_llm_settings_remain_private_only test was deleted along with it —
# there are no remaining private-only settings keys to enforce.


def test_extract_rules_supports_settings_payloads_with_nested_rules():
    rules = _extract_rules(
        {
            "version": 7,
            "rules": [
                {
                    "rule_id": "ask_time_if_missing",
                    "rule_text": "Ask the user for time when it is missing.",
                }
            ],
        }
    )

    assert rules == [
        {
            "rule_id": "ask_time_if_missing",
            "rule_text": "Ask the user for time when it is missing.",
        }
    ]
