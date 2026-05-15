# Tenant Account Setup System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement each phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a self-service-ish admin portal at `/platform` where TatvaCare staff can create new tenants and configure each tenant's app behavior end-to-end via DB writes — no FE deploy needed when adding a tenant or flipping a tenant feature.

**Architecture:** Five-layer system, built bottom-up so each phase is independently testable on prod-shape data:

```
┌────────────────────────────────────────────────────────────┐
│ Phase 6 — Tenant detail + per-app overlay editor (UI)      │
├────────────────────────────────────────────────────────────┤
│ Phase 5 — /platform portal shell + Tenants list (UI)       │
├────────────────────────────────────────────────────────────┤
│ Phase 4 — Provisioning service + admin routes              │
├────────────────────────────────────────────────────────────┤
│ Phase 3 — tenant_application_grants table                  │
├────────────────────────────────────────────────────────────┤
│ Phase 2 — Platform-staff tier + cross-tenant audit         │
├────────────────────────────────────────────────────────────┤
│ Phase 1 — tenant_application_configurations overlay table  │
│            + app_config_resolver service                   │
└────────────────────────────────────────────────────────────┘
```

**Tech stack:**
- Backend: FastAPI + SQLAlchemy 2 (async) + Alembic + Pydantic v2 (`CamelModel`)
- Frontend: React 18 + TypeScript strict + TanStack Query + Zustand + Tailwind v4 + shadcn-style components
- Persistence: Postgres 16, schema `platform`
- Auth: JWT via `get_auth_context`; new dependency `require_platform_staff` lands in Phase 2

---

## Decisions log (locked 2026-05-15)

| # | Question | Answer | Implication |
|---|---|---|---|
| 1 | When does tenant #2 go live? | Within 6 months | Per-tenant overlay table is **Phase 1**, not deferred |
| 2 | Platform super-admin model | First-class tier | New `User.is_platform_staff` + `platform_audit_event_logs` + `require_platform_staff` |
| 3 | Who edits overlay? | Staff full + tenant-owner subset | Two views, one form-component library; `editable_by_tenant_owner` whitelist on each field |
| 4 | Save lifecycle | Draft → Publish + versioned rollback | Overlay rows are versioned (`status`, `version`, `published_at`); same model as orchestration workflows |
| 5 | App provisioning | Explicit per-tenant grants | New `tenant_application_grants` table; setup wizard has an "Apps" step |
| 6 | UI location & v1 scope | Separate `/platform` portal + full overlay editor in v1 | Net-new top-level route; fresh layout (`PlatformShell`); overlay editor ships day-one |

## Out of scope for v1 (deferred)

- Billing / payment / plan tier integration
- Quotas / rate limits / storage caps
- Data residency / region selection
- SSO redemption (schema seam exists in `IdentityInviteLink.signup_method`; UI TBD)
- Custom domains / vanity URLs beyond `tenant_configurations.app_url`
- Tenant deletion / off-boarding flow (manual SQL until v1.1)
- Multi-region deployment

## Phase ordering & dependencies

```
Phase 1  (overlay table + resolver)
   │
   ├─→ Phase 2  (platform-staff tier)        ← can run in parallel with P1
   │       │
   ├─→ Phase 3  (per-tenant app grants)
   │       │
   └─→ Phase 4  (provisioning service)        ← needs P1, P2, P3
              │
              └─→ Phase 5  (/platform shell + Tenants list)
                       │
                       └─→ Phase 6  (tenant detail + overlay editor)
```

**Hard rule:** Phase 1 ships first. Until the resolver exists, every "save" the admin UI does mutates global config — exactly the bug-class this system exists to prevent. Do not begin Phase 4+ work without P1 + P2 in `main`.

## Migration strategy (existing prod tenant)

TatvaCare is the only live tenant on day one. Two principles:

1. **Zero behavior change on day one of Phase 1.** When the resolver ships with no overlay rows in the DB, every `GET /api/apps/{slug}/config` call returns exactly what it returns today (the platform-singleton `applications.config`). Verified by snapshot tests in Phase 1 task T1.10.
2. **TatvaCare gets a SEED overlay row in Phase 4** — when the provisioning service ships, run a one-shot migration that creates an overlay row for TatvaCare with empty `config` (so resolver still falls through to template). This makes TatvaCare a first-class tenant in the new model rather than a special case. The migration is reversible.

## How each phase produces working software

| Phase | "Done" looks like |
|---|---|
| 1 | New table + resolver in prod. `applications.config` is renamed to `applications.config_template`. All existing config reads go through resolver. Behavior unchanged. |
| 2 | A user with `is_platform_staff=true` can hit `GET /api/platform/healthz` (new); regular users get 403. Cross-tenant audit row writes verified end-to-end. |
| 3 | Backend can grant/revoke an app per tenant via SQL; `GET /api/apps` filters by grants. App switcher hides ungranted apps. |
| 4 | `POST /api/platform/tenants` creates a tenant + identity + grants + invite link in one transaction. Idempotent. Audit row written. |
| 5 | `/platform/tenants` lists all tenants. "+ New Tenant" wizard creates one. Shows up in list immediately. |
| 6 | Click tenant → see per-app tabs. Edit overlay → save creates draft. Publish promotes. Resolver returns new values within 1s of publish. |

## Cross-cutting invariants

These hold across every phase and must not be relaxed:

- **All writes that affect another tenant MUST go through `require_platform_staff` AND emit a `platform_audit_event_logs` row in the same transaction.** Skipping the audit is a test-failing bug, not a code-review nit.
- **Every per-tenant config read MUST go through `app_config_resolver.resolve(tenant_id, app_id)`.** Direct `applications.config_template` reads are forbidden outside the resolver itself + Alembic seed. Lint rule lands in Phase 1 task T1.11.
- **Overlays are versioned, immutable per version.** Editing a published version creates a new draft version; no in-place mutation of published rows. Enforced by DB constraint + service-layer guard.
- **Tenant-owner editable fields are an explicit whitelist** declared once in `OVERLAY_TENANT_OWNER_EDITABLE_PATHS` (Phase 6). Any field not on the list is staff-only. Adding a field to the whitelist requires a code change + reviewer sign-off.
- **All user-visible copy in the platform portal follows the project's SaaS tone rule** (Zapier/n8n/HubSpot register: product nouns, no engine jargon, 8–15 words). Copy is reviewed and approved before any FE merge — see project memory `feedback_get_copy_approval_first.md`.
- **No legacy scaffolding.** Per project memory `feedback_no_legacy_scaffolding.md`: when `applications.config` is renamed to `config_template`, all readers update in the same commit. No temp shims, no compat fallbacks. Phase 1 is the rename phase.

## Execution

Per global rule "Phased implementation for non-trivial work": each phase is its own per-phase git branch (`feat/tenant-setup-phase-N-<slug>`) merged to `main` before the next phase begins. Use `/implement-phase` with the phase doc as input, or hand off to a subagent via `superpowers:subagent-driven-development`.

## Phase docs

- [Phase 1 — Overlay table + resolver](phase-01-overlay-and-resolver.md)
- [Phase 2 — Platform-staff tier](phase-02-platform-staff-tier.md)
- [Phase 3 — Per-tenant app grants](phase-03-tenant-application-grants.md)
- [Phase 4 — Provisioning service + admin routes](phase-04-provisioning-service.md)
- [Phase 5 — `/platform` portal shell + Tenants list](phase-05-platform-portal-shell.md)
- [Phase 6 — Tenant detail + overlay editor](phase-06-overlay-editor.md)

## Companion shipped in 412be36 + 0f6c94a

The `quickActions` slot work that landed in this same session (commits `412be36`, `0f6c94a`) is the FE-side prerequisite: the sidebar can now render any menu item the config layer hands it, with three primitive kinds (`openModal` / `triggerImperative` / `navigateTo`) and per-spec label/icon/requirements. The overlay editor in Phase 6 will use this as its canonical "this is what configuring an app actually feels like" example.
