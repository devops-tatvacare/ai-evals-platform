# Phase 6 — Tenant detail + per-app overlay editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Land the per-tenant detail page and the per-app overlay editor — the surface where TatvaCare staff actually configure a tenant's apps. Staff sees everything (features, capabilities, quickActions); tenant owners later get a subset view (out of scope this phase but the form components are reused).

**Architecture:**
- `<TenantDetailPage>` at `/platform/tenants/:tenantId` — header + tabbed app list. Click an app tab → load `<TenantAppOverlayEditor>`.
- `<TenantAppOverlayEditor>` — left: a panel split into sections (Identity overrides, Features, Quick actions, Page actions); right: a live diff vs template + draft/publish controls + version history.
- `OVERLAY_SECTIONS` — single declarative source of truth that drives both the form (left) and the diff (right). Sections list which fields are shown, which are tenant-owner-editable (whitelist for the eventual tenant-side view), and what the input control is.
- Save creates/updates a draft. Publish promotes. Resolver bust is automatic via the BE service. FE invalidates the relevant `/api/apps/{slug}/config` query so the FE-rendered tenant sees the change immediately if they're logged in.
- Quick-actions editor is the showcase: it's a list of `QuickActionSpec` rows (the shape shipped in `412be36`/`0f6c94a`), each editable inline, with add/remove and drag-to-reorder.

**Out of scope:**
- Tenant-owner subset view (tracked as v1.1 — same form components, different field-visibility filter).
- A general-purpose JSON editor for fields not in `OVERLAY_SECTIONS`. (Add fields to the schema rather than offering a free-text JSON escape hatch.)

---

## Files

- **Create:**
  - `src/features/platform/tenants/TenantDetailPage.tsx`
  - `src/features/platform/tenants/TenantAppOverlayEditor.tsx`
  - `src/features/platform/tenants/components/OverlayDiffPanel.tsx`
  - `src/features/platform/tenants/components/OverlayVersionHistory.tsx`
  - `src/features/platform/tenants/components/OverlayFieldSchema.tsx` — declarative schema + section definitions
  - `src/features/platform/tenants/components/quickActionsEditor/QuickActionsEditor.tsx`
  - `src/features/platform/tenants/components/quickActionsEditor/QuickActionRow.tsx`
  - `src/features/platform/queries/overlayQueries.ts`
  - `src/features/platform/api/overlayApi.ts`
  - `src/features/platform/contracts/overlayContracts.ts`
- **Modify:**
  - `src/App.tsx` — register `/platform/tenants/:tenantId` and `.../apps/:slug` routes
  - `CLAUDE.md` — invariant: overlay editor renders from `OVERLAY_SECTIONS`; never hand-roll a per-field input

---

## Task T6.1 — Overlay API + queries (FE)

- [ ] **Step 1: Write `src/features/platform/contracts/overlayContracts.ts`**

Mirror BE Pydantic shapes from Phase 4 as Zod schemas: `OverlayState`, `UpsertDraftRequest`, `PublishDraftRequest`, `OverlayVersionSummary`.

- [ ] **Step 2: Write `src/features/platform/api/overlayApi.ts`**

Functions: `getOverlayState`, `upsertDraft`, `publishDraft`, `revertToVersion`, `listVersions`. Each calls the matching `/api/platform/tenants/.../overlay/...` route and decodes through Zod.

- [ ] **Step 3: Write `src/features/platform/queries/overlayQueries.ts`**

```ts
export const overlayKeys = {
  state: (tenantId: string, slug: string) => ['platform', 'overlay', tenantId, slug, 'state'] as const,
  versions: (tenantId: string, slug: string) => ['platform', 'overlay', tenantId, slug, 'versions'] as const,
};

export function useOverlayState(tenantId: string, slug: string) {
  return useQuery({
    queryKey: overlayKeys.state(tenantId, slug),
    queryFn: apiQueryFn(() => api.getOverlayState(tenantId, slug)),
  });
}

export function useUpsertDraft(tenantId: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: UpsertDraftRequest) => api.upsertDraft(tenantId, slug, req),
    onSuccess: () => qc.invalidateQueries({ queryKey: overlayKeys.state(tenantId, slug) }),
  });
}

export function usePublishDraft(tenantId: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: PublishDraftRequest) => api.publishDraft(tenantId, slug, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: overlayKeys.state(tenantId, slug) });
      qc.invalidateQueries({ queryKey: overlayKeys.versions(tenantId, slug) });
      // Bust the FE app-config query for the affected tenant — if the staff
      // user is currently logged in to that tenant in another tab, this
      // ensures their next render sees the new resolved config.
      qc.invalidateQueries({ queryKey: ['app', 'config', slug] });
    },
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/features/platform/contracts/overlayContracts.ts src/features/platform/api/overlayApi.ts src/features/platform/queries/overlayQueries.ts
git commit -m "feat(platform): overlay API client + TanStack hooks"
```

---

## Task T6.2 — `OVERLAY_SECTIONS`

- [ ] **Step 1: Write `src/features/platform/tenants/components/OverlayFieldSchema.tsx`**

```tsx
/**
 * Declarative schema for the overlay editor.
 *
 * One source of truth that drives:
 *  - Which sections render in the editor (left panel)
 *  - Which input control is used per field (text / select / boolean / nested)
 *  - Which fields are editable by tenant owners (subset view, v1.1)
 *  - Which fields show up in the diff panel (right side)
 *
 * Adding a new editable overlay field = add an entry here. NEVER hand-roll
 * a per-field input in the editor — the schema is the contract.
 */
import type { ComponentType } from 'react';

export type OverlayFieldKind = 'text' | 'boolean' | 'select' | 'multi-text' | 'quickActions';

export interface OverlayField {
  /** Path in the overlay config blob, e.g. `displayName`, `features.hasOrchestration`. */
  path: string;
  label: string;
  description?: string;
  kind: OverlayFieldKind;
  /** For `select` kind: option list. */
  options?: Array<{ value: string; label: string }>;
  /** Tenant-owner-editable. Default: false (staff-only). v1.1 subset view filters by this. */
  editableByTenantOwner?: boolean;
}

export interface OverlaySection {
  id: string;
  title: string;
  description?: string;
  fields: OverlayField[];
}

export const OVERLAY_SECTIONS: OverlaySection[] = [
  {
    id: 'identity',
    title: 'Identity',
    description: 'How this app appears in the tenant’s sidebar and pages.',
    fields: [
      { path: 'displayName', label: 'Display name', kind: 'text', editableByTenantOwner: true },
      { path: 'description', label: 'Description', kind: 'text', editableByTenantOwner: true },
      { path: 'icon', label: 'Icon URL', kind: 'text', editableByTenantOwner: true },
    ],
  },
  {
    id: 'features',
    title: 'Features',
    description: 'Capability flags. Staff-only — changing these affects what users can do.',
    fields: [
      { path: 'features.hasOrchestration', label: 'Workflow orchestration', kind: 'boolean' },
      { path: 'features.hasAdversarial', label: 'Adversarial testing', kind: 'boolean' },
      { path: 'features.hasBatchEval', label: 'Batch evaluation', kind: 'boolean' },
      { path: 'features.hasReviews', label: 'Human review', kind: 'boolean' },
    ],
  },
  {
    id: 'quickActions',
    title: 'Sidebar quick actions',
    description: 'Items in the Run dropdown. Order is preserved.',
    fields: [
      // Single composite field — the QuickActionsEditor knows how to render
      // and edit this. Tenant owners can edit the order and labels but not
      // add/remove items (visibility-only subset, v1.1).
      { path: 'quickActions', label: 'Items', kind: 'quickActions', editableByTenantOwner: true },
    ],
  },
  // Add more sections as the contract grows. Page actions, evaluator
  // defaults, analytics sections, chat capabilities all go here over time.
];
```

- [ ] **Step 2: Commit**

```bash
git add src/features/platform/tenants/components/OverlayFieldSchema.tsx
git commit -m "feat(platform): OVERLAY_SECTIONS — declarative editor schema"
```

---

## Task T6.3 — `<TenantDetailPage>` shell

- [ ] **Step 1: Write the page**

Top: tenant header (name, slug, granted-app chips, "Edit identity" button). Body: tab bar with one tab per granted app + a final "Audit" tab (read-only). Tabs are URL-driven via `?app=<slug>` for shareable links.

Click a tab → mount `<TenantAppOverlayEditor tenantId={...} slug={...} />`.

- [ ] **Step 2: Wire the route**

```tsx
<Route path="/platform/tenants/:tenantId" element={<TenantDetailPage />} />
```

- [ ] **Step 3: Smoke test**

`/platform/tenants/<tatvacare-id>` → see header + 3 tabs (voice-rx, kaira-bot, inside-sales). Click each → editor mounts (placeholder for now).

- [ ] **Step 4: Commit**

```bash
git add src/features/platform/tenants/TenantDetailPage.tsx src/App.tsx
git commit -m "feat(platform): TenantDetailPage with per-app tabs"
```

---

## Task T6.4 — `<TenantAppOverlayEditor>` skeleton

- [ ] **Step 1: Write the layout**

Two-column inside the tab body:
- Left (~60%): scrollable form rendering each `OVERLAY_SECTIONS` entry. Each field becomes a labeled control based on its `kind`.
- Right (~40%): sticky panel with three subsections:
  1. **Diff vs template** — what this draft will change relative to the template + currently-published overlay.
  2. **Draft / Publish controls** — Save Draft, Publish, Discard Draft.
  3. **Version history** — collapsed by default; expand to see prior versions with revert buttons.

Local state: a single `draftPayload` object initialized from `useOverlayState().data`. Each form input updates the path it owns. "Save Draft" calls `useUpsertDraft.mutate(draftPayload)`. "Publish" calls `usePublishDraft.mutate({expectedVersion})`.

- [ ] **Step 2: Render basic field types**

Wire `text`, `boolean`, `select`, `multi-text` to existing UI primitives (`<Input>`, `<Switch>`, `<Select>`, `<TagInput>`). The `quickActions` kind renders a placeholder for T6.5.

- [ ] **Step 3: Smoke test**

Navigate to a tab → see all fields with current overlay values. Toggle a boolean → "Save Draft" → reload → values persist. Click Publish → tab status changes from "Draft" to "Up to date." Cross-tab: open the same tenant in another browser tab as a tenant user — refresh — see the change reflected.

- [ ] **Step 4: Commit**

```bash
git add src/features/platform/tenants/TenantAppOverlayEditor.tsx
git commit -m "feat(platform): TenantAppOverlayEditor draft/publish loop"
```

---

## Task T6.5 — `<QuickActionsEditor>`

- [ ] **Step 1: Write the editor**

Vertical list of `<QuickActionRow>` items. Each row exposes:
- Drag handle (reorder)
- Kind dropdown (`openModal` | `triggerImperative` | `navigateTo`)
- Label (text)
- Description (text)
- Icon (icon-name select; options from `QUICK_ACTION_ICONS` in the existing `iconMap.ts`)
- Config sub-form (varies by kind: `modalId` for openModal, `triggerKey` for triggerImperative, `path` for navigateTo)
- Permission gate (`requires`)
- Requirements (per-spec gates) — collapsible advanced

Bottom: "+ Add quick action" button. Reorder via drag (use the same dnd-kit pattern the orchestration builder uses; do NOT re-roll).

When the parent form passes `value: QuickActionSpec[]` and `onChange`, this component is fully controlled. The schema entry for path `quickActions` wires it in.

- [ ] **Step 2: Validate at the boundary**

Before sending to BE, decode through Zod (same shape as `QuickActionSpec` in `src/types/app.types.ts`). Reject malformed rows with inline error tooltips.

- [ ] **Step 3: Smoke test**

Open Kaira Bot tab → Quick actions section. Reorder an item → Save Draft → Publish → switch to a tenant view of Kaira Bot → see the new order in the sidebar.

- [ ] **Step 4: Commit**

```bash
git add src/features/platform/tenants/components/quickActionsEditor/
git commit -m "feat(platform): QuickActionsEditor (drag reorder + kind-aware config)"
```

---

## Task T6.6 — `<OverlayDiffPanel>`

- [ ] **Step 1: Write the panel**

Three columns: Path, Template (current), Draft (proposed). Skip rows where draft equals template. Highlight changed rows.

Reuse a small JSON-diff utility (or write a 30-line `flattenObject` + key-by-key compare). No need for a fancy diff library.

- [ ] **Step 2: Render in the right rail**

Above the publish controls. Auto-updates as the user edits the form.

- [ ] **Step 3: Commit**

```bash
git add src/features/platform/tenants/components/OverlayDiffPanel.tsx
git commit -m "feat(platform): OverlayDiffPanel renders draft vs template diff"
```

---

## Task T6.7 — `<OverlayVersionHistory>` + revert

- [ ] **Step 1: Write the panel**

Collapsible list of past versions (newest first). Each row: version, status badge (Published/Archived), timestamps, who. For non-current archived versions, a "Revert to this" button that calls `useRevertToVersion()` (which posts to `POST .../overlay/revert`).

- [ ] **Step 2: Reverting is a publish**

Confirm via `<ConfirmDialog>` (the only legitimate use of centered modal). Confirmation text proposed:

> "Reverting will publish a new version with the contents of v{N}. The current published version (v{M}) will be archived. Continue?"

Copy needs approval before merge.

- [ ] **Step 3: Commit**

```bash
git add src/features/platform/tenants/components/OverlayVersionHistory.tsx
git commit -m "feat(platform): OverlayVersionHistory + revert action"
```

---

## Task T6.8 — Invariant in CLAUDE.md

```markdown
- **The overlay editor renders from `OVERLAY_SECTIONS` (`src/features/platform/tenants/components/OverlayFieldSchema.tsx`).** Adding a new editable overlay field means adding an entry there — never a hand-rolled input in `TenantAppOverlayEditor.tsx`. Reason: tenant-owner subset view (v1.1) filters this schema by `editableByTenantOwner`; bypassing the schema breaks that filter and re-introduces hardcoded per-field UIs.
```

Commit:
```bash
git add CLAUDE.md
git commit -m "docs(platform): invariant — overlay editor renders from OVERLAY_SECTIONS"
```

---

## Task T6.9 — End-to-end smoke

- [ ] **Step 1: Edit + publish a real overlay**

As bootstrap admin: `/platform/tenants/<tatvacare-id>` → kaira-bot tab → flip `features.hasOrchestration` to true. Save Draft → diff panel shows the change → Publish.

- [ ] **Step 2: Verify on the tenant side**

Open `/kaira/...` in another tab as the same user (TatvaCare). The "New Workflow" item appears in the sidebar Run dropdown if/when a `quickActions` spec for it exists in the overlay (which is currently empty, so this won't appear yet — but the resolver returns `features.hasOrchestration=true`).

- [ ] **Step 3: Add a quickActions item via the editor**

Same tab → Quick actions section → "+ Add quick action" → kind=`navigateTo`, label="New Workflow", icon=`Workflow`, config.path=`/kaira/campaigns`. Save Draft → Publish.

- [ ] **Step 4: Verify in the kaira sidebar**

Refresh `/kaira` → click Run → see "New Workflow" in the dropdown.

- [ ] **Step 5: Revert**

Versions panel → Revert to the prior published version → confirm → "New Workflow" disappears from the kaira sidebar after refresh.

- [ ] **Step 6: Final commit on the phase branch**

```bash
git commit --allow-empty -m "chore(phase-06): end-to-end smoke complete"
```

---

## Self-review

- [ ] All 11 routes from Phase 4 are exercised by the editor (state, draft, publish, revert, versions).
- [ ] Editing + publishing one tenant's overlay does NOT affect any other tenant (verify by creating a synthetic test tenant + comparing resolved configs).
- [ ] No hand-rolled per-field inputs in `TenantAppOverlayEditor.tsx` — every field comes through `OVERLAY_SECTIONS`.
- [ ] No centered modals; the only `<ConfirmDialog>` is the revert confirmation.
- [ ] All proposed user-visible copy listed in the plan; nothing merged without approval.
- [ ] Phase 6 branch is `feat/tenant-setup-phase-06-overlay-editor`. Merge to `main` to complete the v1 system.

---

## What v1.1 looks like (for the next plan, not this one)

After this phase ships, the v1 system is complete: a TatvaCare staff user can create new tenants and configure their apps end-to-end via DB writes with no FE deploys.

Logical follow-ons (each its own plan doc when prioritized):
- Tenant-owner subset view: same form components, filtered by `editableByTenantOwner`. Mounts under `/admin/configuration` (per-tenant chrome).
- Audit log viewer: paginated table of `platform_audit_event_logs` with filters by actor / target tenant / action / date range.
- Tenant suspension / off-boarding: `tenants.is_active=false` + cascade through grants + provider-connection deactivation.
- Billing / plan tier surface: a `tenant_plans` table + per-plan capability matrix that gates what a tenant can grant themselves.
- SSO redemption: implement the schema seam already present in `IdentityInviteLink.signup_method='sso'`.
