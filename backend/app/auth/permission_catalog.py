"""Backend-owned permission catalog metadata and helpers."""

from dataclasses import dataclass


@dataclass(frozen=True)
class PermissionCatalogEntry:
    id: str
    label: str
    description: str
    group_id: str
    group_label: str
    grantable: bool = True
    owner_only: bool = False


@dataclass(frozen=True)
class PermissionGroup:
    id: str
    label: str
    description: str
    permissions: tuple[PermissionCatalogEntry, ...]


PERMISSION_GROUPS: tuple[PermissionGroup, ...] = (
    PermissionGroup(
        id='listings',
        label='Listings',
        description='Create and remove listing records.',
        permissions=(
            PermissionCatalogEntry(
                id='listing:create',
                label='Create listings',
                description='Create new listings for the apps a role can access.',
                group_id='listings',
                group_label='Listings',
            ),
            PermissionCatalogEntry(
                id='listing:delete',
                label='Delete listings',
                description='Delete existing listings in accessible apps.',
                group_id='listings',
                group_label='Listings',
            ),
        ),
    ),
    PermissionGroup(
        id='evaluations',
        label='Evaluations',
        description='Run, export, and manage evaluation jobs and runs.',
        permissions=(
            PermissionCatalogEntry(
                id='evaluation:run',
                label='Run evaluations',
                description='Submit evaluation jobs and start evaluation workflows.',
                group_id='evaluations',
                group_label='Evaluations',
            ),
            PermissionCatalogEntry(
                id='evaluation:cancel',
                label='Cancel evaluations',
                description='Cancel in-flight evaluation work without deleting completed records.',
                group_id='evaluations',
                group_label='Evaluations',
            ),
            PermissionCatalogEntry(
                id='evaluation:delete',
                label='Delete evaluations',
                description='Delete evaluation records and related destructive evaluation artifacts.',
                group_id='evaluations',
                group_label='Evaluations',
            ),
            PermissionCatalogEntry(
                id='evaluation:export',
                label='Export evaluation results',
                description='Download evaluation and reporting outputs.',
                group_id='evaluations',
                group_label='Evaluations',
            ),
        ),
    ),
    PermissionGroup(
        id='assets',
        label='Assets',
        description='Manage shareable prompts, schemas, evaluators, chat artifacts, and tags.',
        permissions=(
            PermissionCatalogEntry(
                id='asset:create',
                label='Create assets',
                description='Create prompts, schemas, evaluators, tags, and related assets.',
                group_id='assets',
                group_label='Assets',
            ),
            PermissionCatalogEntry(
                id='asset:edit',
                label='Edit assets',
                description='Edit prompts, schemas, evaluators, tags, and related assets.',
                group_id='assets',
                group_label='Assets',
            ),
            PermissionCatalogEntry(
                id='asset:delete',
                label='Delete assets',
                description='Delete prompts, schemas, evaluators, tags, and related assets.',
                group_id='assets',
                group_label='Assets',
            ),
            PermissionCatalogEntry(
                id='asset:share',
                label='Share assets',
                description='Change visibility on owned shareable assets.',
                group_id='assets',
                group_label='Assets',
            ),
        ),
    ),
    PermissionGroup(
        id='reviews',
        label='Reviews',
        description='Review evaluation outcomes and submit human overrides.',
        permissions=(
            PermissionCatalogEntry(
                id='review:manage',
                label='Manage reviews',
                description='Open review surfaces, save drafts, and finalize human review decisions.',
                group_id='reviews',
                group_label='Reviews',
            ),
        ),
    ),
    PermissionGroup(
        id='insights',
        label='Reports and insights',
        description='Generate reports and view analytics surfaces.',
        permissions=(
            PermissionCatalogEntry(
                id='report:generate',
                label='Generate reports',
                description='Create report runs and derived report artifacts.',
                group_id='insights',
                group_label='Reports and insights',
            ),
            PermissionCatalogEntry(
                id='insights:view',
                label='View analytics',
                description='Access analytics dashboards, summaries, and reporting views.',
                group_id='insights',
                group_label='Reports and insights',
            ),
        ),
    ),
    PermissionGroup(
        id='configuration',
        label='Configuration',
        description='Manage tenant-scoped settings, rules, and app configuration assets.',
        permissions=(
            PermissionCatalogEntry(
                id='configuration:edit',
                label='Edit configuration',
                description='Edit app settings, rule catalogs, and other configuration assets.',
                group_id='configuration',
                group_label='Configuration',
            ),
        ),
    ),
    PermissionGroup(
        id='users',
        label='User management',
        description='Manage users, invite links, and role assignment.',
        permissions=(
            PermissionCatalogEntry(
                id='user:create',
                label='Create users',
                description='Create users inside the current tenant.',
                group_id='users',
                group_label='User management',
            ),
            PermissionCatalogEntry(
                id='invite_link:manage',
                label='Manage invite links',
                description='Create, deactivate, and inspect invite links.',
                group_id='users',
                group_label='User management',
            ),
            PermissionCatalogEntry(
                id='user:edit',
                label='Edit users',
                description='Edit mutable user profile and assignment details.',
                group_id='users',
                group_label='User management',
            ),
            PermissionCatalogEntry(
                id='user:deactivate',
                label='Deactivate users',
                description='Disable or re-enable tenant users.',
                group_id='users',
                group_label='User management',
            ),
            PermissionCatalogEntry(
                id='user:delete',
                label='Delete users',
                description='Permanently delete a tenant user and their refresh tokens.',
                group_id='users',
                group_label='User management',
            ),
            PermissionCatalogEntry(
                id='user:reset_password',
                label='Reset passwords',
                description='Trigger password resets for tenant users.',
                group_id='users',
                group_label='User management',
            ),
            PermissionCatalogEntry(
                id='role:assign',
                label='Assign roles',
                description='Assign existing roles to users.',
                group_id='users',
                group_label='User management',
            ),
        ),
    ),
)

OWNER_ONLY_SURFACES: tuple[dict[str, str], ...] = (
    {
        'id': 'role:lifecycle',
        'label': 'Manage role lifecycle',
        'description': 'Create, update, and delete roles remains owner-only.',
    },
    {
        'id': 'tenant:configuration',
        'label': 'Manage tenant identity and configuration',
        'description': 'Tenant identity and tenant-level configuration remains owner-only.',
    },
    {
        'id': 'platform:bootstrap',
        'label': 'Platform bootstrap actions',
        'description': 'System bootstrapping and platform-only setup actions are not grantable.',
    },
    {
        'id': 'cost:access',
        'label': 'Cost & usage',
        'description': 'View cost dashboards, raw call logs, and current pricing (Owner-only).',
    },
    {
        'id': 'cost:pricing',
        'label': 'Pricing',
        'description': 'Manage global pricing rows (super-admin only).',
    },
    {
        'id': 'cost:pricing.refresh',
        'label': 'Refresh pricing from models.dev',
        'description': 'Refresh the global pricing catalog from models.dev (super-admin only).',
    },
)

PERMISSION_INDEX: dict[str, PermissionCatalogEntry] = {
    permission.id: permission
    for group in PERMISSION_GROUPS
    for permission in group.permissions
}

VALID_PERMISSIONS: frozenset[str] = frozenset(PERMISSION_INDEX.keys())


def get_permission_definition(permission_id: str) -> PermissionCatalogEntry | None:
    return PERMISSION_INDEX.get(permission_id)


def serialize_permission_catalog() -> dict[str, list[dict[str, object]]]:
    return {
        'groups': [
            {
                'id': group.id,
                'label': group.label,
                'description': group.description,
                'permissions': [
                    {
                        'id': permission.id,
                        'label': permission.label,
                        'description': permission.description,
                        'groupId': permission.group_id,
                        'groupLabel': permission.group_label,
                        'grantable': permission.grantable,
                        'ownerOnly': permission.owner_only,
                    }
                    for permission in group.permissions
                ],
            }
            for group in PERMISSION_GROUPS
        ],
        'ownerOnlySurfaces': list(OWNER_ONLY_SURFACES),
    }
