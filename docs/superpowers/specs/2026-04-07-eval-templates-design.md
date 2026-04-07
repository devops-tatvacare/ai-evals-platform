# Evaluation Templates — Prompt + Schema Pairs

**Date:** 2026-04-07
**Status:** Draft
**Mocks:** `.superpowers/brainstorm/36994-1775584474/content/01-05`

## Summary

Merge the standalone Prompts and Schemas libraries into a single **Evaluation Templates** concept — each template is a versioned prompt + schema pair. Templates surface in the custom evaluator wizard as a "pick from library or write your own" toggle. Voice-RX and other built-in pipelines remain untouched — they continue using `is_default=True` system templates internally.

### Core Principles

- **Pairs, not solos.** A template is always prompt + schema together. Any edit to either side creates a new version of the pair.
- **All or nothing.** In the evaluator wizard, you pick a template pair or write from scratch. No mixing.
- **Version pinning.** Evaluators reference a specific template version. Upgrades are explicit, never silent.
- **Existing components.** No new UI primitives. Use `SchemaTable`, `WizardOverlay`, `SearchableSelect`, `Badge`, `VisibilityToggle`, `Tabs`, `Modal`, existing table patterns, and design tokens from `globals.css`.

---

## Data Model

### New Table: `eval_templates`

Replaces both `prompts` and `schemas` tables.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | One row per version |
| `app_id` | varchar(50), NOT NULL | |
| `template_type` | varchar(20), NOT NULL | `transcription` / `evaluation` / `extraction` |
| `source_type` | varchar(10), nullable | `upload` / `api` / null |
| `branch_key` | varchar(100), NOT NULL | Identity of the template (same across versions) |
| `version` | int, NOT NULL | Auto-increment within branch |
| `name` | varchar(200), NOT NULL | User-facing name |
| `description` | text, nullable | |
| `prompt` | text, NOT NULL | Prompt template with `{{variables}}` |
| `schema_data` | JSONB, NOT NULL | Schema content |
| `schema_format` | varchar(20), NOT NULL | `json_schema` (Voice-RX) or `output_fields` (custom evals) |
| `variables_used` | JSONB, NOT NULL, default `[]` | Computed on save: `["transcript", "audio"]` |
| `change_summary` | varchar(20), nullable | `prompt` / `schema` / `both` / `created` |
| `is_default` | bool, NOT NULL, default false | System-owned, immutable |
| `forked_from` | UUID FK → `eval_templates.id`, nullable | Lineage |
| + `TenantUserMixin` | | `tenant_id`, `user_id` |
| + `TimestampMixin` | | `created_at`, `updated_at` |
| + `ShareableMixin` | | `visibility`, `shared_by`, `shared_at` |

**Unique constraint:** `(tenant_id, app_id, template_type, source_type, branch_key, version)`

**`schema_format` discriminator:**
- `json_schema`: `schema_data` is a raw JSON Schema object `{type: "object", properties: {...}}`. Used by Voice-RX transcription/evaluation system defaults. Runner passes directly to LLM.
- `output_fields`: `schema_data` is `EvaluatorOutputField[]` — the rich format with `displayMode`, `isMainMetric`, `thresholds`, `role`. Used by custom eval templates. Runner converts to JSON Schema via existing `schema_generator.py`.

### Evaluator Model Changes

Two new nullable columns on `evaluators`:

| Column | Type | Notes |
|--------|------|-------|
| `template_id` | UUID FK → `eval_templates.id`, nullable | Points to the specific version row |
| `template_branch_key` | varchar(100), nullable | For "newer version available" lookup |

**Behavior:**
- `template_id` is set → runner loads `prompt` and `schema_data` from the referenced `eval_templates` row. Evaluator's own `prompt` and `output_schema` columns are ignored.
- `template_id` is null → runner uses evaluator's inline `prompt` and `output_schema` (backward compatible, current behavior).
- Both columns are set or both are null. Never one without the other.

### EvalRun Config Snapshot

No change to snapshot behavior. `EvalRun.config` continues to store the resolved prompt text and schema at execution time — whether it came from a template or inline. Full reproducibility preserved.

### Migration

1. Create `eval_templates` table.
2. Migrate existing `prompts` + `schemas` rows into paired templates:
   - Match by `(tenant_id, user_id, app_id, prompt_type, source_type, branch_key, version)`.
   - Where a prompt has no matching schema: create template with `schema_data={}`, `schema_format='json_schema'`.
   - Where a schema has no matching prompt: create template with `prompt=''` (empty string).
   - System defaults (`is_default=True`) map to `schema_format='json_schema'`.
3. Add `template_id` and `template_branch_key` columns to `evaluators` (nullable, no backfill — existing evaluators stay inline).
4. Drop `prompts` and `schemas` tables after verification.
5. Remove `activePromptIds`, `activeSchemaIds` from `llm-settings` seed defaults.

---

## API Routes

### New: `/api/eval-templates`

Replaces `/api/prompts` and `/api/schemas`. Same auth patterns.

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/eval-templates` | `require_app_access()` | Query: `app_id` (required), `template_type`, `source_type`, `branch_key`, `latest_only` (default true), `filter` (all/private/shared). Uses `readable_scope_clause`. |
| GET | `/api/eval-templates/{id}` | `require_app_access()` | Single template by version row ID. Uses `readable_scope_clause`. |
| GET | `/api/eval-templates/branch/{branch_key}/versions` | `require_app_access()` | All versions of a branch. For version history UI. |
| POST | `/api/eval-templates` | `require_permission('asset:create')` + `require_app_access()` | Create new template (v1 of new branch). Auto-generates `branch_key`. Computes `variables_used` from prompt text. Sets `change_summary='created'`. |
| POST | `/api/eval-templates/{id}/new-version` | `require_permission('asset:edit')` + `require_app_access()` | Create new version of existing branch. Owner-only for own templates. Computes diff to determine `change_summary` (prompt/schema/both). Auto-increments version. |
| POST | `/api/eval-templates/{id}/fork` | `require_permission('asset:create')` + `require_app_access()` | Fork readable template into new private branch (v1). Sets `forked_from`. |
| PUT | `/api/eval-templates/{id}` | `require_permission('asset:edit')` + `require_app_access()` | Update metadata only (name, description). Does NOT create new version. Owner-only. |
| PATCH | `/api/eval-templates/{id}/visibility` | `require_permission('asset:share')` + `require_app_access()` | Toggle visibility. Owner-only. |
| DELETE | `/api/eval-templates/{id}` | `require_permission('asset:delete')` + `require_app_access()` | Delete template version. System defaults protected. Owner-only. |

### Modified: `/api/evaluators`

- `POST /api/evaluators` and `PUT /api/evaluators/{id}`: Accept optional `template_id` and `template_branch_key` in request body. When set, `prompt` and `output_schema` fields are optional (ignored by runner).
- `GET /api/evaluators` and `GET /api/evaluators/{id}`: Response includes `template_id`, `template_branch_key`, and a computed `template_upgrade_available: bool` field (true if latest version in branch > pinned version).

### Removed Routes

- `/api/prompts/*` — all endpoints
- `/api/schemas/*` — all endpoints

---

## Frontend

### Design System Usage

All components below use existing primitives. No new UI components are created. No hardcoded colors — all via `var(--*)` tokens and Tailwind classes referencing the theme.

| Need | Component | Source |
|------|-----------|--------|
| Template table | Raw `<table>` with same pattern as `EvaluatorsTable` | Existing pattern |
| Peek overlay | Right panel using fixed positioning + `var(--border-default)` borders | Same pattern as existing overlays |
| Peek tabs | `Tabs` | `src/components/ui/Tabs.tsx` |
| Template picker dropdown | `SearchableSelect` with custom `renderOption` | `src/components/ui/SearchableSelect.tsx` |
| Source toggle (Use Template / Write Custom) | Same pattern as `BuildModeToggle` | `src/features/evals/components/BuildModeToggle.tsx` |
| Version banner (amber save prompt) | `Alert` component with `warning` variant + action button | `src/components/ui/Alert.tsx` |
| Schema builder | `SchemaTable` (unmodified) | `src/features/evals/components/SchemaTable.tsx` |
| Badges (version, visibility, type, change) | `Badge` with appropriate variants | `src/components/ui/Badge.tsx` |
| Visibility toggle | `VisibilityToggle` | `src/components/ui/VisibilityToggle.tsx` |
| Variable tags | `Badge` variant=info, size=sm, monospace font | Existing |
| Upgrade review modal | `Modal` | `src/components/ui/Modal.tsx` |
| Diff view (prompt) | New minimal component — two `<pre>` blocks side by side, added lines get `var(--surface-success)` bg, removed get `var(--surface-error)` bg | No external library needed |
| Schema diff | Table rows with `Badge` (added/modified/removed/unchanged) | Existing table + Badge pattern |
| Confirmation dialogs | `ConfirmDialog` | `src/components/ui/ConfirmDialog.tsx` |
| Fork notice | `Alert` variant=info | Existing |
| Loading states | `Skeleton`, `SkeletonTableRow` | Existing |

### Store Changes

**New: `useEvalTemplatesStore`** (replaces `usePromptsStore` + `useSchemasStore`)

```typescript
interface EvalTemplatesState {
  templates: Record<AppId, EvalTemplate[]>;  // latest-only by default
  isLoaded: Record<AppId, boolean>;

  // Actions
  loadTemplates(appId: AppId): Promise<void>;
  getTemplate(appId: AppId, id: string): EvalTemplate | undefined;
  getTemplatesByType(appId: AppId, type: TemplateType): EvalTemplate[];
  getBranchVersions(appId: AppId, branchKey: string): Promise<EvalTemplate[]>;
  createTemplate(appId: AppId, data: CreateTemplatePayload): Promise<EvalTemplate>;
  createNewVersion(templateId: string, data: NewVersionPayload): Promise<EvalTemplate>;
  forkTemplate(appId: AppId, templateId: string): Promise<EvalTemplate>;
  updateMetadata(templateId: string, data: UpdateMetadataPayload): Promise<EvalTemplate>;
  setVisibility(templateId: string, visibility: Visibility): Promise<EvalTemplate>;
  deleteTemplate(appId: AppId, templateId: string): Promise<void>;
}
```

**Remove:** `usePromptsStore`, `useSchemasStore`, `activePromptIds`, `activeSchemaIds` from `useLLMSettingsStore`.

**Modify:** `useEvaluatorsStore` — add `checkUpgradeAvailable(evaluatorId)` computed from template data.

### Settings UI

**Replace** PromptsTab + SchemasTab with single **TemplatesTab** (`src/features/settings/components/TemplatesTab.tsx`).

**Layout:** Two-panel — table on left, peek overlay on right (slides in when row clicked).

**Table columns:** Name (+ description), Type badge, Version, Variables (monospace badges), Visibility badge, Updated.

**Filter bar:**
- Type filter: segmented control (All / Evaluation / Transcription / Extraction) — same pattern as `BuildModeToggle`.
- Ownership filter: segmented control (My Templates / Shared / System).
- Action: `+ New Template` button (primary).

**Peek overlay tabs** (using `Tabs` component):
- **Prompt** — prompt text in `<pre>` with monospace (`var(--font-mono)`), `{{variables}}` highlighted with `Badge` variant=info. Fork/Edit buttons in header.
- **Schema** — field list rendered as compact cards. Each shows field name (monospace), type, role badge, thresholds (colored per RYG).
- **History** — version timeline. Each entry: version number, date, author, `Badge` for change type (prompt changed / schema changed / both / created). Click a version to load it in Prompt/Schema tabs.

**System templates** shown with `Badge` variant=warning text "SYSTEM", muted row opacity. Not editable, forkable.

### Evaluator Wizard Changes

**Step 2 (Prompt) modifications:**

1. Add source toggle at top: "Use Template" / "Write Custom" — using `BuildModeToggle` pattern.
2. **Template mode:**
   - `SearchableSelect` dropdown for template picker. Options grouped by: "My Templates", "Shared in Team", "System Defaults". Each option shows name, version, owner.
   - On selection: pair summary below dropdown — two side-by-side cards showing prompt preview (truncated + variable badges) and schema preview (field names + main metric badge).
   - `Alert` variant=info: *"This prompt comes from the template. Edit below to create a new version."*
   - Prompt text displayed in `<pre>` block (monospace, read-only initially).
   - If user edits the text: `Alert` variant=warning appears: *"Prompt modified. Save to create vN of [name]."* with "Save as vN" action button.
   - If template is shared (not owned): `Alert` variant=info fork notice: *"This is a shared template. Editing will fork it as your own private copy (v1)."*
3. **Custom mode:** Current textarea + variable picker + Generate Draft. No change.

**Step 3 (Schema) modifications:**

1. **Template mode:**
   - `SchemaTable` component pre-populated with `schema_data` from selected template (when `schema_format='output_fields'`).
   - `Alert` variant=info: *"Schema from template [name] vN. Add, edit, or remove any field to create a new version."*
   - Dirty detection: any change to `SchemaTable` fields (add, remove, edit type/thresholds/description/role/displayMode, reorder) triggers the amber `Alert` variant=warning with "Save as vN" button.
   - Same fork notice for shared templates.
2. **Custom mode:** Current `SchemaTable` builder. No change.

**Dirty detection implementation:**
- On template selection, snapshot the original `prompt` text and `schema_data` (deep clone).
- On every change, compare current state against snapshot.
- If different, show amber alert. If reverted back to original, hide it.
- "Save as vN" calls `POST /api/eval-templates/{id}/new-version` (or fork endpoint if not owned), then updates the wizard state to reference the new version.

**Step 4 (Rules):** No change.

**On wizard save:**
- If template mode: evaluator created/updated with `template_id` = selected version row ID, `template_branch_key` = branch key. `prompt` and `output_schema` fields set to empty/null.
- If custom mode: evaluator created/updated with `template_id` = null, `template_branch_key` = null. `prompt` and `output_schema` set as today.

### Evaluators Table Changes

**Source column** added to `EvaluatorsTable`:
- Template-linked: `Badge` variant=info showing template name + version (e.g., "Clinical Evaluation v3").
- Upgrade available: additional `Badge` variant=warning showing "↑ vN" next to the template badge. Clickable — opens upgrade review modal.
- Custom (no template): `Badge` variant=neutral showing "custom".

### Version Upgrade Flow

**Upgrade review modal** (new component, uses existing `Modal`):
- Header: evaluator name, current version → new version, author, date.
- Two tabs (using `Tabs`):
  - **Prompt Diff**: side-by-side `<pre>` blocks. Left = current, right = new. Added lines: `var(--surface-success)` bg. Removed: `var(--surface-error)` bg. Simple line-by-line diff (no external library — split by newlines, compare).
  - **Schema Diff**: table showing each field with status badge (unchanged / modified / added / removed) and detail column for what changed.
- Footer: reassurance text (*"Previous runs retain their original config"*), "Stay on vN" button (secondary), "Upgrade to vN" button (primary).
- Upgrade action: `PUT /api/evaluators/{id}` with new `template_id` pointing to latest version row.

**Bulk upgrade** (stretch goal, not required for v1):
- When a template gets a new version, show a banner in the evaluators view listing all evaluators pinned to the old version.
- "Review & Upgrade All" opens a summary modal, then batch-updates all evaluators.

---

## Backend Runner Changes

### `custom_evaluator_runner.py`

After loading the evaluator from DB:

```python
if evaluator.template_id:
    template = await db.get(EvalTemplate, evaluator.template_id)
    prompt_text = template.prompt
    if template.schema_format == 'output_fields':
        output_schema = template.schema_data  # EvaluatorOutputField[]
    else:
        output_schema = None  # json_schema passed directly
        json_schema = template.schema_data
else:
    prompt_text = evaluator.prompt
    output_schema = evaluator.output_schema
```

Rest of the runner flow unchanged — `resolve_prompt()`, `generate_json_schema()`, LLM call, score extraction all work the same.

### `voice_rx_runner.py`

Model import changes only. Currently queries `Prompt` and `Schema` models — update to query `EvalTemplate` with same filters (`app_id`, `template_type`, `source_type`, `is_default=True`). Column names change: `Prompt.prompt` → `EvalTemplate.prompt`, `Schema.schema_data` → `EvalTemplate.schema_data`. Query logic is identical.

---

## Dead Code Removal

| Item | Location | Action |
|------|----------|--------|
| `activePromptIds` / `activeSchemaIds` | `useLLMSettingsStore` | Remove fields, remove `setActivePromptId`, `setActiveSchemaId` methods |
| `resolvePromptText()` | `src/services/prompts/resolvePromptText.ts` | Delete file |
| `usePromptsStore` | `src/stores/promptsStore.ts` | Delete file |
| `useSchemasStore` | `src/stores/schemasStore.ts` | Delete file |
| `PromptsTab` | `src/features/settings/components/PromptsTab.tsx` | Delete file (replaced by TemplatesTab) |
| `SchemasTab` | `src/features/settings/components/SchemasTab.tsx` | Delete file (replaced by TemplatesTab) |
| `PromptCreateOverlay` | Settings prompt creation | Delete (replaced by template creation) |
| `SchemaCreateOverlay` | Settings schema creation | Delete (replaced by template creation) |
| `PromptGeneratorModal` | AI prompt generation | Keep — can be reused in template creation flow |
| `SchemaGeneratorModal` | AI schema generation | Keep — can be reused in template creation flow |
| Prompt/Schema routes | `backend/app/routes/prompts.py`, `schemas.py` | Delete files |
| Prompt/Schema models | `backend/app/models/prompt.py`, `schema.py` | Delete after migration |
| Prompt/Schema Pydantic schemas | `backend/app/schemas/prompt.py`, `schema.py` | Delete, replace with eval_template schemas |
| `promptsApi.ts`, `schemasApi.ts` | `src/services/api/` | Delete, replace with `evalTemplatesApi.ts` |
| Prompt/Schema types | `src/types/prompt.types.ts`, `schema.types.ts` | Delete, replace with `evalTemplate.types.ts` |
| Settings seed defaults | `seed_defaults.py` | Update to seed `eval_templates` instead of separate prompts + schemas |
| LLM settings seed | `seed_defaults.py` | Remove `activePromptIds` / `activeSchemaIds` from default settings payload |

---

## RBAC & Auth

No new permissions needed. Template operations map to existing permissions:

| Operation | Permission | Scope |
|-----------|-----------|-------|
| List/read templates | `require_app_access()` | `readable_scope_clause` (own + shared + system) |
| Create template | `asset:create` + `require_app_access()` | Own tenant |
| Create new version | `asset:edit` + `require_app_access()` | Owner-only (own templates). Shared templates → fork instead. |
| Fork template | `asset:create` + `require_app_access()` | Any readable template |
| Update metadata | `asset:edit` + `require_app_access()` | Owner-only |
| Change visibility | `asset:share` + `require_app_access()` | Owner-only |
| Delete template | `asset:delete` + `require_app_access()` | Owner-only. System defaults protected. |

---

## Scope Boundaries

**In scope:**
- `eval_templates` table, model, routes, Pydantic schemas
- `evaluators` model changes (template_id, template_branch_key)
- Settings TemplatesTab (replaces PromptsTab + SchemasTab)
- Evaluator wizard source toggle + template picker + dirty detection + version save
- Evaluators table source column + upgrade badge
- Upgrade review modal with prompt/schema diff
- Custom evaluator runner template loading
- Migration script
- Dead code removal
- Seed defaults update

**Out of scope (future):**
- Bulk upgrade across evaluators
- Template analytics (which templates are most used)
- Template import/export
- AI-powered template suggestions during wizard
- Template tagging/categorization beyond type filter
