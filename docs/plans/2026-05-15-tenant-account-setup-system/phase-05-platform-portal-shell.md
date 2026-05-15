# Phase 5 — `/platform` portal shell + Tenants list

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Stand up the new `/platform` route tree, gated by `is_platform_staff`, with a fresh shell (`PlatformShell`) and a Tenants list. By the end of this phase, a platform-staff user can log in, navigate to `/platform/tenants`, and create a new tenant via a wizard.

**Architecture:**
- A net-new top-level route `/platform` with its own layout. Distinct from the existing `/admin` (which is per-tenant). The URL itself signals "you are now in cross-tenant mode."
- `<PlatformShell>` — left sidebar with Tenants nav item (Tenants today; Audit Log + Apps Catalog land in v1.1).
- `<TenantsListPage>` — table of all tenants, "+ New Tenant" CTA opens a `<NewTenantWizard>` slide-over.
- TanStack Query for all reads (per project rule "Server-data fetching → useQuery").
- App switcher gets a "Platform" entry visible only to staff.

**Out of scope this phase:**
- Tenant detail page (Phase 6).
- Per-app overlay editor (Phase 6).
- Audit Log viewer (v1.1).
- Tenant deletion / suspension UI (manual SQL until v1.1).

---

## Files

- **Create:**
  - `src/features/platform/PlatformShell.tsx`
  - `src/features/platform/PlatformSidebar.tsx`
  - `src/features/platform/queries/platformQueries.ts` (TanStack Query hooks)
  - `src/features/platform/api/platformApi.ts` (typed HTTP client)
  - `src/features/platform/tenants/TenantsListPage.tsx`
  - `src/features/platform/tenants/NewTenantWizard.tsx` (RightSlideOverShell)
  - `src/features/platform/tenants/components/TenantsTable.tsx`
  - `src/features/platform/contracts/tenantContracts.ts` (Zod schemas matching BE Pydantic)
  - `src/features/platform/index.ts`
- **Modify:**
  - `src/config/routes.ts` — add `routes.platform.*`
  - `src/App.tsx` (or main router) — register `/platform/*` route subtree under `<RequirePlatformStaff>` guard
  - `src/components/auth/RequirePlatformStaff.tsx` — new permission guard
  - `src/components/layout/AppSwitcher.tsx` — show "Platform" entry when `user.isPlatformStaff`
  - `src/types/user.ts` (or wherever User type lives) — add `isPlatformStaff: boolean`
  - `src/services/api/auth.ts` — surface the boolean from the `/me` response
  - Backend `/api/auth/me` route — include `isPlatformStaff` in the response payload

---

## Task T5.1 — Backend: surface `isPlatformStaff` on `/api/auth/me`

- [ ] **Step 1: Update `/api/auth/me` response shape**

Find the `/me` route, add `isPlatformStaff: bool` to the response model + the JSON body. (`AuthContext` already carries the field after Phase 2.)

- [ ] **Step 2: Test**

```python
async def test_me_includes_is_platform_staff(client, platform_staff_auth):
    response = await client.get("/api/auth/me", headers=platform_staff_auth)
    body = response.json()
    assert body["isPlatformStaff"] is True
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/routes/auth.py backend/tests/routes/test_auth.py
git commit -m "feat(auth): /api/auth/me exposes isPlatformStaff"
```

---

## Task T5.2 — Frontend: User type + auth store update

- [ ] **Step 1: Add `isPlatformStaff: boolean` to `User` type and the auth store user shape**

- [ ] **Step 2: Update the `me` decoder to read the new field (default false if missing)**

- [ ] **Step 3: Quick smoke**

In the dev server, log in as bootstrap admin → open React DevTools → confirm `useAuthStore.getState().user.isPlatformStaff === true`.

- [ ] **Step 4: Commit**

```bash
git add src/types/user.ts src/stores/authStore.ts src/services/api/auth.ts
git commit -m "feat(auth): isPlatformStaff in User + auth store"
```

---

## Task T5.3 — `<RequirePlatformStaff>` route guard

- [ ] **Step 1: Write the component**

```tsx
// src/components/auth/RequirePlatformStaff.tsx
import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';

export function RequirePlatformStaff({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/auth/login" replace />;
  if (!user.isPlatformStaff) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/auth/RequirePlatformStaff.tsx
git commit -m "feat(auth): RequirePlatformStaff route guard"
```

---

## Task T5.4 — Routes config

- [ ] **Step 1: Add `routes.platform` to `src/config/routes.ts`**

```ts
export const routes = {
  // ... existing routes ...
  platform: {
    root: '/platform',
    tenants: '/platform/tenants',
    tenantDetail: (id: string) => `/platform/tenants/${id}`,
    tenantApp: (id: string, slug: string) => `/platform/tenants/${id}/apps/${slug}`,
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/config/routes.ts
git commit -m "feat(routes): /platform route tree"
```

---

## Task T5.5 — `PlatformShell` + sidebar

- [ ] **Step 1: Write `src/features/platform/PlatformShell.tsx`**

A two-column layout: `PlatformSidebar` on the left (~240px), `<Outlet />` on the right inside a `PageSurface`-ish container. Mounted under `<RequirePlatformStaff>`. Uses the existing design tokens (`var(--bg-secondary)`, etc.), no new colors.

- [ ] **Step 2: Write `src/features/platform/PlatformSidebar.tsx`**

Single nav item today: "Tenants". Visually distinct from the per-tenant sidebar — header reads "Platform" with a small badge "Cross-tenant mode" so staff know they're in the elevated context.

**Copy: needs approval before merge** (per project memory `feedback_get_copy_approval_first.md`).

Proposed:
- Header: "Platform"
- Subhead/badge: "Cross-tenant mode"
- Nav item: "Tenants"

- [ ] **Step 3: Wire into the router**

```tsx
// src/App.tsx (or wherever the router lives)
<Route
  path="/platform/*"
  element={
    <RequirePlatformStaff>
      <PlatformShell />
    </RequirePlatformStaff>
  }
>
  <Route path="tenants" element={<TenantsListPage />} />
</Route>
```

- [ ] **Step 4: Smoke test**

Navigate to `http://localhost:5173/platform/tenants` as bootstrap admin → see the shell + Tenants nav item highlighted. As a regular tenant user, the same URL bounces to `/`.

- [ ] **Step 5: Commit**

```bash
git add src/features/platform/PlatformShell.tsx src/features/platform/PlatformSidebar.tsx src/App.tsx
git commit -m "feat(platform): PlatformShell + sidebar (gated by RequirePlatformStaff)"
```

---

## Task T5.6 — App switcher: surface "Platform" for staff

- [ ] **Step 1: Update `AppSwitcher.tsx` dropdown**

When `user.isPlatformStaff`, append a `Platform` entry to `dropdownOptions` (after Admin). Uses a distinct icon (e.g. `Building2`) so it visually separates from per-tenant Admin.

- [ ] **Step 2: Smoke test**

Log in as bootstrap admin → open app switcher → see "Platform" entry. Clicking it navigates to `/platform/tenants`.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppSwitcher.tsx
git commit -m "feat(layout): AppSwitcher shows Platform entry for staff"
```

---

## Task T5.7 — Typed HTTP client + Zod contracts

- [ ] **Step 1: Write `src/features/platform/contracts/tenantContracts.ts`**

Mirror the BE Pydantic shapes (`CreateTenantRequest`, `CreateTenantResponse`, `TenantSummary`) as Zod schemas. Per project rule: every `apiQueryFn` call decodes the response through Zod at the boundary.

- [ ] **Step 2: Write `src/features/platform/api/platformApi.ts`**

```ts
import { apiRequest } from '@/services/api/client';
import {
  type CreateTenantRequest,
  type CreateTenantResponse,
  type TenantSummary,
  CreateTenantResponseSchema,
  TenantSummarySchema,
} from '../contracts/tenantContracts';
import { z } from 'zod';

export async function listTenants(): Promise<TenantSummary[]> {
  const raw = await apiRequest('/api/platform/tenants');
  return z.array(TenantSummarySchema).parse(raw);
}

export async function createTenant(payload: CreateTenantRequest): Promise<CreateTenantResponse> {
  const raw = await apiRequest('/api/platform/tenants', { method: 'POST', body: JSON.stringify(payload) });
  return CreateTenantResponseSchema.parse(raw);
}
```

- [ ] **Step 3: Write `src/features/platform/queries/platformQueries.ts` (TanStack Query hooks)**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiQueryFn } from '@/features/orchestration/queries/queryFn';
import * as api from '../api/platformApi';

export const platformKeys = {
  tenants: () => ['platform', 'tenants'] as const,
};

export function useTenants() {
  return useQuery({
    queryKey: platformKeys.tenants(),
    queryFn: apiQueryFn(api.listTenants),
  });
}

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createTenant,
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.tenants() }),
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/features/platform/contracts/ src/features/platform/api/ src/features/platform/queries/
git commit -m "feat(platform): typed HTTP client + Zod contracts + TanStack hooks"
```

---

## Task T5.8 — `<TenantsListPage>` + `<TenantsTable>`

- [ ] **Step 1: Write `TenantsListPage.tsx`**

Mounts inside `PlatformShell`. Header: "Tenants" + "+ New Tenant" button (right-aligned). Body: `<TenantsTable />`. Empty state when zero tenants returned (only true on a brand-new install — TatvaCare always shows up for prod).

**Copy: needs approval before merge.**

Proposed:
- Page title: "Tenants"
- CTA: "+ New Tenant"
- Empty state title: "No tenants yet"
- Empty state body: "Create the first tenant to get started."

- [ ] **Step 2: Write `<TenantsTable>`**

Columns: Name, Slug, Apps (chip list of granted slugs), Users (count), Created. Reuse the unified `<DataTable>` from `src/components/ui/DataTable/`. Click a row → navigate to tenant detail (Phase 6 page; until then, a placeholder).

- [ ] **Step 3: Smoke test**

Log in as bootstrap admin → `/platform/tenants` → see TatvaCare in the list with 3 app chips.

- [ ] **Step 4: Commit**

```bash
git add src/features/platform/tenants/
git commit -m "feat(platform): TenantsListPage + TenantsTable"
```

---

## Task T5.9 — `<NewTenantWizard>`

- [ ] **Step 1: Write `NewTenantWizard.tsx`**

Mounts inside `<RightSlideOverShell>` (per project memory `feedback_no_modals_except_confirm.md` — never a centered modal). Three-step wizard:

1. **Identity** — Name, Slug (auto-derived from name, editable), Allowed email domains (multi-input chips), Logo URL, App URL.
2. **Apps** — Multi-select from `useAppsCatalog()` (a sibling query that lists all active applications). Each selected app row has an optional "initial overlay" — for v1 leave this empty by default; only show an `Advanced` collapsible.
3. **Initial owner** — Email + a button "Create tenant & generate invite link." On success, show the invite link with a Copy button.

Footer button progresses through steps; final step calls `useCreateTenant()`. On success the slide-over closes and the table refreshes.

**Copy: needs approval before merge.** Proposed strings to be reviewed:
- Step titles: "Identity" / "Apps" / "First admin"
- Identity field labels: "Tenant name" / "URL slug" / "Allowed email domains" / "Logo URL (optional)" / "App URL (optional)"
- Apps step header: "Which apps does this tenant get?"
- First-admin step: "Send a tenant owner an invite to set up their account."
- Success: "Tenant created. Send {{owner_email}} this invite link to finish setup."

- [ ] **Step 2: Smoke test**

Click "+ New Tenant" → fill Identity step → Next → pick "Kaira Bot" → Next → enter `smoke@test.local` → Create. Slide-over shows the invite link. Close it; the new tenant appears in the table.

- [ ] **Step 3: Cleanup**

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM platform.tenants WHERE slug='\''smoke-test'\'';"'
```

- [ ] **Step 4: Commit**

```bash
git add src/features/platform/tenants/NewTenantWizard.tsx
git commit -m "feat(platform): NewTenantWizard slide-over (identity + apps + owner)"
```

---

## Self-review

- [ ] `/platform/tenants` renders the table for bootstrap admin; bounces regular users to `/`.
- [ ] `+ New Tenant` wizard creates a tenant end-to-end, the new row appears in the table immediately (TanStack invalidation).
- [ ] All copy strings flagged for approval are listed in this plan; no merged copy without explicit user sign-off (see project memory `feedback_get_copy_approval_first.md`).
- [ ] No centered modals — the wizard is a `RightSlideOverShell`.
- [ ] No hex colors in new TSX files — design tokens only.
- [ ] Phase 5 branch is `feat/tenant-setup-phase-05-portal`. Merge to `main` before Phase 6.
