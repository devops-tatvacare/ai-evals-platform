"""Unit tests for backend permission catalog and guard normalization."""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / 'app'
_catalog_path = APP_ROOT / 'auth' / 'permission_catalog.py'
_catalog_spec = importlib.util.spec_from_file_location('permission_catalog', _catalog_path)
assert _catalog_spec and _catalog_spec.loader
_catalog_module = importlib.util.module_from_spec(_catalog_spec)
sys.modules['permission_catalog'] = _catalog_module
_catalog_spec.loader.exec_module(_catalog_module)

PERMISSION_GROUPS = _catalog_module.PERMISSION_GROUPS
OWNER_ONLY_SURFACES = _catalog_module.OWNER_ONLY_SURFACES
VALID_PERMISSIONS = _catalog_module.VALID_PERMISSIONS
serialize_permission_catalog = _catalog_module.serialize_permission_catalog

LEGACY_PERMISSION_IDS = {
    'eval:run',
    'eval:delete',
    'eval:export',
    'resource:create',
    'resource:edit',
    'resource:delete',
    'analytics:view',
    'settings:edit',
    'user:invite',
}

ROUTE_EXPECTATIONS = {
    'routes/jobs.py': [
        "require_permission('evaluation:run')",
        "require_permission('evaluation:cancel')",
    ],
    'routes/eval_runs.py': [
        "require_permission('insights:view')",
        "require_permission('evaluation:delete')",
        "require_permission('asset:share')",
    ],
    'routes/reports.py': [
        "require_permission('insights:view')",
        "require_permission('evaluation:export')",
        "require_permission('asset:share')",
    ],
    'routes/admin.py': [
        "require_permission('insights:view')",
        "require_permission('configuration:edit')",
        "require_permission('invite_link:manage')",
        "ensure_permissions(auth, 'role:assign')",
        "ensure_permissions(auth, 'user:edit')",
        "ensure_permissions(auth, 'user:deactivate')",
    ],
    'routes/prompts.py': ["require_permission('asset:share')"],
    'routes/schemas.py': ["require_permission('asset:share')"],
    'routes/evaluators.py': ["require_permission('asset:share')"],
    'routes/settings.py': ["require_permission('configuration:edit')"],
    'routes/rules.py': ["require_permission('configuration:edit')"],
    'routes/adversarial_config.py': ["require_permission('configuration:edit')"],
    'routes/adversarial_test_cases.py': ['require_permission("configuration:edit")'],
}


def test_permission_enum_has_all_expected_values():
    expected = {
        'listing:create',
        'listing:delete',
        'evaluation:run',
        'evaluation:cancel',
        'evaluation:delete',
        'evaluation:export',
        'asset:create',
        'asset:edit',
        'asset:delete',
        'asset:share',
        'report:generate',
        'insights:view',
        'configuration:edit',
        'user:create',
        'invite_link:manage',
        'user:edit',
        'user:deactivate',
        'user:reset_password',
        'role:assign',
    }
    assert VALID_PERMISSIONS == expected


def test_permission_enum_values_match_resource_action_format():
    for permission_id in VALID_PERMISSIONS:
        assert ':' in permission_id, f'Permission {permission_id} missing colon separator'
        resource, action = permission_id.split(':', 1)
        assert len(resource) > 0
        assert len(action) > 0


def test_valid_permissions_is_frozenset():
    assert isinstance(VALID_PERMISSIONS, frozenset)


def test_permission_catalog_groups_cover_every_grantable_permission_once():
    catalog_ids: set[str] = set()
    for group in PERMISSION_GROUPS:
        for permission in group.permissions:
            assert permission.id not in catalog_ids, f'Duplicate permission ID in catalog: {permission.id}'
            catalog_ids.add(permission.id)
    assert catalog_ids == VALID_PERMISSIONS


def test_permission_catalog_serialization_excludes_removed_permissions():
    payload = serialize_permission_catalog()

    serialized_ids = {
        permission['id']
        for group in payload['groups']
        for permission in group['permissions']
    }

    assert serialized_ids == VALID_PERMISSIONS
    assert 'tenant:settings' not in serialized_ids
    assert 'evaluator:promote' not in serialized_ids


def test_permission_catalog_serialization_preserves_group_and_permission_metadata_shape():
    payload = serialize_permission_catalog()

    assert set(payload.keys()) == {'groups', 'ownerOnlySurfaces'}
    assert len(payload['groups']) == len(PERMISSION_GROUPS)

    first_group = payload['groups'][0]
    assert set(first_group.keys()) == {'id', 'label', 'description', 'permissions'}

    first_permission = first_group['permissions'][0]
    assert set(first_permission.keys()) == {
        'id',
        'label',
        'description',
        'groupId',
        'groupLabel',
        'grantable',
        'ownerOnly',
    }
    assert first_permission['grantable'] is True
    assert first_permission['ownerOnly'] is False


def test_permission_catalog_serialization_exposes_owner_only_surfaces_separately():
    payload = serialize_permission_catalog()

    assert payload['ownerOnlySurfaces'] == list(OWNER_ONLY_SURFACES)
    assert {surface['id'] for surface in payload['ownerOnlySurfaces']} == {
        'role:lifecycle',
        'tenant:configuration',
        'platform:bootstrap',
    }


def test_catalog_permission_group_metadata_matches_parent_group():
    for group in PERMISSION_GROUPS:
        for permission in group.permissions:
            assert permission.group_id == group.id
            assert permission.group_label == group.label


def test_backend_app_contains_no_legacy_permission_ids():
    hits: dict[str, list[str]] = {}
    for path in APP_ROOT.rglob('*.py'):
        contents = path.read_text()
        found = sorted(permission for permission in LEGACY_PERMISSION_IDS if permission in contents)
        if found:
            hits[path.relative_to(ROOT).as_posix()] = found
    assert hits == {}


def test_key_routes_reference_canonical_permissions():
    for relative_path, expected_snippets in ROUTE_EXPECTATIONS.items():
        contents = (APP_ROOT / relative_path).read_text()
        for snippet in expected_snippets:
            assert snippet in contents, f'Missing {snippet} in {relative_path}'


def test_admin_route_uses_helper_for_inline_permission_checks():
    contents = (APP_ROOT / 'routes' / 'admin.py').read_text()
    assert ' not in auth.permissions' not in contents
