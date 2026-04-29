"""Asset policy metadata and helpers for shareable asset families."""

from dataclasses import dataclass


@dataclass(frozen=True)
class AssetPolicy:
    shareable: bool = True
    sharing_enabled: bool = True
    latest_version_only: bool = False
    forking_enabled: bool = True
    private_only_keys: frozenset[str] = frozenset()


ASSET_POLICIES: dict[str, AssetPolicy] = {
    'evaluator': AssetPolicy(),
    'prompt': AssetPolicy(),
    'schema': AssetPolicy(),
    'settings': AssetPolicy(private_only_keys=frozenset({'llm-settings'})),
}

ASSET_FAMILY_ALIASES: dict[str, str] = {
    'evaluators': 'evaluator',
    'evaluator': 'evaluator',
    'prompts': 'prompt',
    'prompt': 'prompt',
    'library_prompt_definitions': 'prompt',
    'library_prompt_definition': 'prompt',
    'librarypromptdefinition': 'prompt',
    'schemas': 'schema',
    'schema': 'schema',
    'library_output_schema_definitions': 'schema',
    'library_output_schema_definition': 'schema',
    'libraryoutputschemadefinition': 'schema',
    'settings': 'settings',
    'setting': 'settings',
    'application_settings': 'settings',
    'application_setting': 'settings',
    'applicationsetting': 'settings',
}


def normalize_asset_family(asset_family: str | None) -> str | None:
    if asset_family is None:
        return None
    return ASSET_FAMILY_ALIASES.get(asset_family.strip().lower())


def resolve_asset_family(asset) -> str | None:
    raw_family = (
        getattr(asset, 'asset_family', None)
        or getattr(asset, '__tablename__', None)
        or asset.__class__.__name__
    )
    return normalize_asset_family(str(raw_family))


def get_asset_policy(asset_family: str | None) -> AssetPolicy:
    normalized = normalize_asset_family(asset_family)
    if normalized is None:
        return AssetPolicy()
    return ASSET_POLICIES.get(normalized, AssetPolicy())


def get_asset_policy_for_asset(asset) -> AssetPolicy:
    return get_asset_policy(resolve_asset_family(asset))


def is_private_only_asset_key(
    asset_family: str | None,
    key: str | None,
) -> bool:
    if key is None:
        return False
    return key in get_asset_policy(asset_family).private_only_keys


def is_private_only_asset_key_for_asset(asset) -> bool:
    return is_private_only_asset_key(resolve_asset_family(asset), getattr(asset, 'key', None))


def default_app_authorization_config() -> dict[str, dict[str, dict[str, object]]]:
    return {
        'asset_policies': {
            family: {
                'shareable': policy.shareable,
                'sharing_enabled': policy.sharing_enabled,
                'latest_version_only': policy.latest_version_only,
                'forking_enabled': policy.forking_enabled,
                'private_only_keys': sorted(policy.private_only_keys),
            }
            for family, policy in ASSET_POLICIES.items()
        }
    }
