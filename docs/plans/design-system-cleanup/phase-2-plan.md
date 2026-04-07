# Phase 2 — Design System Sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every consumer to new components, eliminate all hardcoded hex/z-index values, delete old components.

**Architecture:** File-by-file migration. Each task is isolated — if one file breaks, revert that file only. Old components are deleted last after all consumers are migrated.

**Tech Stack:** Same as Phase 1. Phase 1 must be merged to main before starting.

**Spec:** `docs/plans/design-system-cleanup/spec.md`

**Prerequisite:** Phase 1 merged to main. Branch from main: `feat/phase-2-design-system-sweep`

---

### Task 1: Migrate SingleSelect consumers to Select

**Files:**
- Modify: `src/features/insideSales/components/TranscriptionConfigStep.tsx`
- Modify: `src/features/admin/InviteLinksSection.tsx`
- Modify: `src/features/evalRuns/components/report/ReportTab.tsx`

- [ ] **Step 1: Migrate TranscriptionConfigStep.tsx**

In `src/features/insideSales/components/TranscriptionConfigStep.tsx`:

Change import (line 7):
```tsx
// Old:
import { SingleSelect } from '@/components/ui';
import type { SingleSelectOption } from '@/components/ui';
// New:
import { Select } from '@/components/ui';
import type { SelectOption } from '@/components/ui';
```

Change type annotations (lines 10, 17, 23):
```tsx
// Old:
const LANGUAGE_OPTIONS: SingleSelectOption[] = [
const SCRIPT_OPTIONS: SingleSelectOption[] = [
const MODEL_OPTIONS: SingleSelectOption[] = [
// New:
const LANGUAGE_OPTIONS: SelectOption[] = [
const SCRIPT_OPTIONS: SelectOption[] = [
const MODEL_OPTIONS: SelectOption[] = [
```

Change component usage (lines 73, 84, 95 — three instances):
```tsx
// Old:
<SingleSelect
// New:
<Select
```

- [ ] **Step 2: Check for SingleSelect usage in InviteLinksSection and ReportTab**

Search for `SingleSelect` in both files and replace with `Select` using the same import pattern. Update type references from `SingleSelectOption` to `SelectOption`.

- [ ] **Step 3: Verify no remaining SingleSelect imports in features**

Run: `grep -r 'SingleSelect' src/features/ --include='*.tsx' -l`
Expected: No results.

- [ ] **Step 4: Verify build**

Run: `npx tsc -b && npm run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: migrate SingleSelect consumers to new Select component"
```

---

### Task 2: Migrate SearchableSelect consumers to Combobox

**Files:**
- Modify: `src/features/evalRuns/components/AdversarialComparisonPanel.tsx`
- Modify: `src/features/evals/components/EvaluationOverlay.tsx`

- [ ] **Step 1: Migrate AdversarialComparisonPanel.tsx**

In `src/features/evalRuns/components/AdversarialComparisonPanel.tsx`:

Change import (line 4):
```tsx
// Old:
import { Card, SearchableSelect } from '@/components/ui';
// New:
import { Card, Combobox } from '@/components/ui';
```

Change component usage (line 239):
```tsx
// Old:
<SearchableSelect
  value={selectedBaselineRunId}
  onChange={setSelectedBaselineRunId}
  options={baselineOptions}
  placeholder="Select a baseline run"
/>
// New:
<Combobox
  value={selectedBaselineRunId}
  onChange={setSelectedBaselineRunId}
  options={baselineOptions}
  placeholder="Select a baseline run"
/>
```

- [ ] **Step 2: Migrate EvaluationOverlay.tsx**

In `src/features/evals/components/EvaluationOverlay.tsx`:

Change import (lines 19, 22):
```tsx
// Old:
  SearchableSelect,
import type { SearchableSelectOption } from "@/components/ui";
// New:
  Combobox,
import type { ComboboxOption } from "@/components/ui";
```

Change type annotations (lines 46, 53, 59):
```tsx
// Old:
const LANGUAGE_OPTIONS: SearchableSelectOption[] = LANGUAGES.map(...)
const SCRIPT_OPTIONS: SearchableSelectOption[] = SCRIPTS.map(...)
const TARGET_SCRIPT_OPTIONS: SearchableSelectOption[] = SCRIPTS.filter(...)
// New:
const LANGUAGE_OPTIONS: ComboboxOption[] = LANGUAGES.map(...)
const SCRIPT_OPTIONS: ComboboxOption[] = SCRIPTS.map(...)
const TARGET_SCRIPT_OPTIONS: ComboboxOption[] = SCRIPTS.filter(...)
```

Change component usage (lines 377, 388, 432 — three instances):
```tsx
// Old:
<SearchableSelect
// New:
<Combobox
```

- [ ] **Step 3: Verify no remaining SearchableSelect imports**

Run: `grep -r 'SearchableSelect' src/features/ --include='*.tsx' -l`
Expected: No results.

- [ ] **Step 4: Verify build**

Run: `npx tsc -b && npm run build`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: migrate SearchableSelect consumers to Combobox"
```

---

### Task 3: Migrate MultiSelect consumers to Combobox multi

**Files:**
- Modify: `src/features/evalRuns/components/ContractRuleSelectionPanel.tsx`
- Modify: `src/features/insideSales/components/SelectCallsStep.tsx`
- Modify: `src/features/insideSales/components/CallFilterPanel.tsx`

- [ ] **Step 1: Migrate ContractRuleSelectionPanel.tsx**

Change import (line 3):
```tsx
// Old:
import { MultiSelect, type MultiSelectOption } from '@/components/ui';
// New:
import { Combobox, type ComboboxOption } from '@/components/ui';
```

Change type (line 36):
```tsx
// Old:
const [options, setOptions] = useState<MultiSelectOption[]>([]);
// New:
const [options, setOptions] = useState<ComboboxOption[]>([]);
```

Change component usage (line 114):
```tsx
// Old:
<MultiSelect
  values={resolvedSelectedRuleIds}
  onChange={(nextValues) => { ... }}
  options={options}
  placeholder="Select contract rules"
/>
// New:
<Combobox
  multi
  value={resolvedSelectedRuleIds}
  onChange={(nextValues) => { ... }}
  options={options}
  placeholder="Select contract rules"
/>
```

- [ ] **Step 2: Migrate SelectCallsStep.tsx**

Change import (line 8):
```tsx
// Old:
import { Input, Button, MultiSelect } from '@/components/ui';
// New:
import { Input, Button, Combobox } from '@/components/ui';
```

Change component usage (line 125):
```tsx
// Old:
<MultiSelect
  values={config.agents}
  onChange={(agents) => onConfigChange({ agents })}
  options={agentOptions}
  placeholder="Select agents..."
/>
// New:
<Combobox
  multi
  value={config.agents}
  onChange={(agents) => onConfigChange({ agents })}
  options={agentOptions}
  placeholder="Select agents..."
/>
```

- [ ] **Step 3: Migrate CallFilterPanel.tsx**

Change import (line 7):
```tsx
// Old:
import { Button, MultiSelect } from '@/components/ui';
// New:
import { Button, Combobox } from '@/components/ui';
```

Change all three `<MultiSelect>` usages (lines 119, 149, 181) to `<Combobox multi>`. Change `values` prop to `value` in each:

```tsx
// Old pattern:
<MultiSelect
  values={leadFilters.stage}
  onChange={(stage) => ...}
  options={STAGE_OPTIONS}
  placeholder="Select stages..."
/>
// New pattern:
<Combobox
  multi
  value={leadFilters.stage}
  onChange={(stage) => ...}
  options={STAGE_OPTIONS}
  placeholder="Select stages..."
/>
```

- [ ] **Step 4: Verify no remaining MultiSelect imports**

Run: `grep -r 'MultiSelect' src/features/ --include='*.tsx' -l`
Expected: No results.

- [ ] **Step 5: Verify build**

Run: `npx tsc -b && npm run build`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: migrate MultiSelect consumers to Combobox multi mode"
```

---

### Task 4: Replace native select elements

**Files:**
- Modify: `src/features/settings/components/SchemaSelector.tsx`
- Modify: `src/features/settings/components/PromptSelector.tsx`
- Modify: `src/features/settings/components/SchemaEditor.tsx`
- Modify: `src/features/admin/CreateUserDialog.tsx`
- Modify: `src/features/admin/EditUserDialog.tsx`
- Modify: `src/features/csvImport/components/CsvFieldMapper.tsx`
- Modify: `src/features/evals/components/OutputSchemaBuilder.tsx`
- Modify: `src/features/evals/components/InlineSchemaBuilder.tsx`
- Modify: `src/features/evals/components/ArrayItemConfigModal.tsx`

- [ ] **Step 1: Migrate SchemaSelector.tsx**

Add import at top:
```tsx
import { Select } from '@/components/ui';
import type { SelectOption } from '@/components/ui';
```

Build options array from typeSchemas:
```tsx
const schemaOptions: SelectOption[] = useMemo(
  () => typeSchemas.map((s) => ({
    value: s.id,
    label: `${s.name}${s.isDefault ? ' (default)' : ''}`,
  })),
  [typeSchemas],
);
```

Replace both `<select>` blocks (compact variant around line 88 and default around line 143) with:
```tsx
<Select
  value={value?.id || ''}
  onChange={(id) => {
    const schema = typeSchemas.find((s) => s.id === id);
    if (schema) onSelect(schema);
  }}
  options={schemaOptions}
  placeholder="Select schema..."
  size={compact ? 'sm' : 'md'}
/>
```

Remove the `<ChevronDown>` overlay icon (no longer needed — Select has its own).

- [ ] **Step 2: Migrate PromptSelector.tsx**

Add import: `import { Select } from '@/components/ui';`

Build options:
```tsx
const promptOptions = useMemo(
  () => prompts.map((p) => ({
    value: p.id,
    label: `${p.name}${p.isDefault ? ' (built-in)' : ''}`,
  })),
  [prompts],
);
```

Replace the `<select>` block (line 39-57) with:
```tsx
<Select
  value={selectedId || ''}
  onChange={(id) => { if (id) onSelect(id); }}
  options={promptOptions}
  placeholder="Select prompt template..."
  disabled={disabled}
/>
```

Remove the `<ChevronDown>` overlay icon.

- [ ] **Step 3: Migrate CreateUserDialog.tsx**

Add import: `import { Select } from '@/components/ui';`

Build options:
```tsx
const roleOptions = useMemo(
  () => roles.map((r) => ({ value: r.id, label: r.name })),
  [roles],
);
```

Replace `<select>` (lines 126-134) with:
```tsx
<Select
  value={roleId}
  onChange={setRoleId}
  options={roleOptions}
/>
```

- [ ] **Step 4: Migrate EditUserDialog.tsx**

Same pattern as CreateUserDialog. Replace `<select>` (lines 115-124) with:
```tsx
<Select
  value={roleId}
  onChange={setRoleId}
  options={roleOptions}
  disabled={!canChangeRole}
/>
```

- [ ] **Step 5: Migrate CsvFieldMapper.tsx**

Add import: `import { Select } from '@/components/ui';`

Build options dynamically:
```tsx
const columnOptions = useMemo(
  () => [
    { value: '', label: '— select column —' },
    ...csvHeaders.map((col) => ({
      value: col,
      label: `${col}${usedSources.has(col.toLowerCase()) && currentSource.toLowerCase() !== col.toLowerCase() ? ' (used)' : ''}`,
    })),
  ],
  [csvHeaders, usedSources, currentSource],
);
```

Replace `<select>` (lines 100-118) with:
```tsx
<Select
  value={currentSource}
  onChange={(val) => handleFieldMap(targetField, val)}
  options={columnOptions}
  size="sm"
/>
```

- [ ] **Step 6: Migrate OutputSchemaBuilder.tsx, InlineSchemaBuilder.tsx, ArrayItemConfigModal.tsx**

These three files use native `<select>` for field type selection. Same pattern for each:

Add import: `import { Select } from '@/components/ui';`

Define type options constant (shared across all three):
```tsx
const FIELD_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'array', label: 'Array' },
];
```

Replace each `<select>` with:
```tsx
<Select
  value={field.type}
  onChange={(val) => updateField(index, { type: val as EvaluatorFieldType })}
  options={FIELD_TYPE_OPTIONS}
  size="sm"
/>
```

For ArrayItemConfigModal, the options are `string/number/boolean` (no array):
```tsx
const PROPERTY_TYPE_OPTIONS = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
];
```

- [ ] **Step 7: Migrate SchemaEditor.tsx**

Replace the `<select>` for schema version selection (line 142-156) with:
```tsx
<Select
  value={value?.id || ''}
  onChange={(id) => {
    const schema = typeSchemas.find((s) => s.id === id);
    if (schema) handleVersionChange(schema);
  }}
  options={typeSchemas.map((s) => ({
    value: s.id,
    label: `${s.name}${s.isDefault ? ' (default)' : ''}`,
  }))}
  placeholder={`Select ${PROMPT_TYPE_LABELS[promptType]} Schema`}
/>
```

- [ ] **Step 8: Verify no remaining native selects**

Run: `grep -rn '<select' src/ --include='*.tsx' | grep -v 'node_modules' | grep -v '.test.'`
Expected: Zero results (or only in test files).

- [ ] **Step 9: Verify build**

Run: `npx tsc -b && npm run build`

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: replace all native HTML select elements with Select component"
```

---

### Task 5: Migrate pagination consumers

**Files:**
- Modify: `src/features/admin/AdminUsersPage.tsx`
- Modify: `src/features/admin/InviteLinksSection.tsx`
- Modify: `src/features/evalRuns/pages/RunList.tsx`
- Modify: `src/features/evalRuns/components/EvalTable.tsx`

- [ ] **Step 1: Migrate AdminUsersPage.tsx pagination**

Add import: `import { Pagination } from '@/components/ui';`

Replace the pagination block (lines 217-234) with:
```tsx
<Pagination
  page={page}
  totalPages={totalPages}
  onPageChange={setPage}
  showCount
  totalItems={filtered.length}
  pageSize={ROWS_PER_PAGE}
  className="mt-3"
/>
```

- [ ] **Step 2: Migrate InviteLinksSection.tsx pagination**

Add import: `import { Pagination } from '@/components/ui';`

Replace the pagination block (lines 297-309) with:
```tsx
<Pagination
  page={page}
  totalPages={totalPages}
  onPageChange={setPage}
  showCount
  totalItems={filtered.length}
  pageSize={ROWS_PER_PAGE}
  className="mt-3"
/>
```

- [ ] **Step 3: Migrate RunList.tsx pagination**

Add import: `import { Pagination } from '@/components/ui';`

RunList uses 0-based page indexing. The `Pagination` component uses 1-based. Wrap the handler:

Replace the pagination block (lines 454-482) with:
```tsx
{!loading && totalPages > 1 && (
  <Pagination
    page={page + 1}
    totalPages={totalPages}
    onPageChange={(p) => setPage(p - 1)}
    className="pt-1 pb-2"
  />
)}
```

- [ ] **Step 4: Migrate EvalTable.tsx pagination**

Add import: `import { Pagination } from '@/components/ui';`

EvalTable also uses 0-based page indexing. Replace the pagination block (lines 307-340) with:
```tsx
<div className="mt-1.5">
  <Pagination
    page={safePage + 1}
    totalPages={totalPages}
    onPageChange={(p) => setPage(p - 1)}
    showCount
    totalItems={sorted.length}
    pageSize={PAGE_SIZE}
  />
</div>
```

- [ ] **Step 5: Remove unused imports**

In each migrated file, remove `ChevronLeft`, `ChevronRight`, and `Button` imports if they are no longer used elsewhere in the file. Check each file individually.

- [ ] **Step 6: Verify build**

Run: `npx tsc -b && npm run build`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: replace copy-pasted pagination with Pagination component"
```

---

### Task 6: Color sweep — sectionInfo.tsx

**Files:**
- Modify: `src/features/evalRuns/components/report/sectionInfo.tsx`

This file has ~50 hardcoded hex colors all as `dot="#hexcolor"` and `style={{ color: '#hexcolor' }}` props on `<Row>` components.

- [ ] **Step 1: Create color mapping at top of file**

Add after imports:
```tsx
/** Map semantic labels to CSS variable colors for report legends. */
const DOT = {
  pass: 'var(--color-verdict-pass)',
  softFail: 'var(--color-verdict-soft-fail)',
  hardFail: 'var(--color-verdict-fail)',
  critical: 'var(--color-verdict-critical)',
  na: 'var(--color-verdict-na)',
  easy: 'var(--color-level-easy)',
  medium: 'var(--color-level-medium)',
  hard: 'var(--color-level-hard)',
  info: 'var(--color-info)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
  underspec: 'var(--color-gap-underspec)',
  silent: 'var(--color-gap-silent)',
  leakage: 'var(--color-gap-leakage)',
  conflicting: 'var(--color-gap-conflicting)',
  p0: 'var(--priority-p0-accent)',
  p1: 'var(--priority-p1-accent)',
  p2: 'var(--priority-p2-accent)',
} as const;

const GRADE_COLOR = {
  good: 'var(--color-success)',
  mid: 'var(--color-warning)',
  bad: 'var(--color-error)',
} as const;
```

- [ ] **Step 2: Replace all hex color references**

Replace every `dot="#hexvalue"` and `style={{ color: '#hexvalue' }}` with the appropriate `DOT.*` or `GRADE_COLOR.*` reference. The mapping:

| Old hex | New token |
|---------|-----------|
| `#10b981` | `DOT.success` |
| `#f59e0b` | `DOT.warning` |
| `#ef4444` | `DOT.error` |
| `#16a34a` | `DOT.pass` |
| `#ca8a04` | `DOT.softFail` |
| `#dc2626` | `DOT.hardFail` |
| `#7c2d12` | `DOT.critical` |
| `#6b7280` | `DOT.na` |
| `#3b82f6` | `DOT.info` |
| `#8b5cf6` | `DOT.conflicting` |
| `#F59E0B` | `DOT.warning` |
| `#EF4444` | `DOT.error` |

For the grade scale (lines 69-80), replace:
```tsx
// Old:
<span className="font-semibold" style={{ color: '#10b981' }}>A+</span>
// New:
<span className="font-semibold" style={{ color: GRADE_COLOR.good }}>A+</span>
```

Apply `GRADE_COLOR.good` for A+/A/A-/B+/B/B-, `GRADE_COLOR.mid` for C+/C/C-, `GRADE_COLOR.bad` for D+/D/F.

- [ ] **Step 3: Verify build**

Run: `npx tsc -b && npm run build`

- [ ] **Step 4: Verify no remaining hex in file**

Run: `grep '#[0-9a-fA-F]\{3,8\}' src/features/evalRuns/components/report/sectionInfo.tsx`
Expected: No results.

- [ ] **Step 5: Commit**

```bash
git add src/features/evalRuns/components/report/sectionInfo.tsx
git commit -m "fix: replace 50 hardcoded hex colors in sectionInfo with design tokens"
```

---

### Task 7: Color sweep — KairaReportView.tsx

**Files:**
- Modify: `src/features/evalRuns/components/report/KairaReportView.tsx`

- [ ] **Step 1: Replace gradeHex function (lines 62-65)**

```tsx
// Old:
function gradeHex(grade: string): string {
  if (grade.startsWith('A') || grade.startsWith('B')) return '#10b981';
  if (grade.startsWith('C')) return '#f59e0b';
  return '#ef4444';
}
// New:
function gradeHex(grade: string): string {
  if (grade.startsWith('A') || grade.startsWith('B')) return 'var(--color-success)';
  if (grade.startsWith('C')) return 'var(--color-warning)';
  return 'var(--color-error)';
}
```

- [ ] **Step 2: Replace print cover section hex colors (lines 753-825)**

Replace hardcoded hex values:
- `background: '#0f172a'` → `background: 'var(--color-neutral-900)'`
- `color: '#fff'` → `color: 'var(--text-inverse)'`
- `background: '#38bdf8'` → `background: 'var(--color-info)'`
- `color: '#0f172a'` → `color: 'var(--color-neutral-900)'`
- `color: '#94a3b8'` → `color: 'var(--text-muted)'`
- `color: '#64748b'` → `color: 'var(--text-secondary)'`
- `border: '1px solid #e2e8f0'` → `border: '1px solid var(--border-default)'`

- [ ] **Step 3: Verify build**

Run: `npx tsc -b && npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/features/evalRuns/components/report/KairaReportView.tsx
git commit -m "fix: replace hardcoded hex colors in KairaReportView with design tokens"
```

---

### Task 8: Color sweep — EvaluatorCard, CustomNarrative, ReportTab

**Files:**
- Modify: `src/features/evalRuns/components/report/customEval/EvaluatorCard.tsx`
- Modify: `src/features/evalRuns/components/report/customEval/CustomNarrative.tsx`
- Modify: `src/features/evalRuns/components/report/ReportTab.tsx`

- [ ] **Step 1: Fix EvaluatorCard.tsx**

Replace the `scoreColor` function hardcoded hex (lines 16-18):
```tsx
// Old:
if (value >= thresholds.greenThreshold) return '#10B981';
if (thresholds.yellowThreshold != null && value >= thresholds.yellowThreshold) return '#F59E0B';
return '#EF4444';
// New:
if (value >= thresholds.greenThreshold) return 'var(--color-success)';
if (thresholds.yellowThreshold != null && value >= thresholds.yellowThreshold) return 'var(--color-warning)';
return 'var(--color-error)';
```

Replace `color: "#3b82f6"` (line 112) with `color: 'var(--color-info)'`.

Replace color constants in chart data arrays (lines 140-164, 193):
```tsx
// Replace all instances:
'#10B981' → 'var(--color-success)'
'#F59E0B' → 'var(--color-warning)'
'#EF4444' → 'var(--color-error)'
'#3b82f6' → 'var(--color-info)'
'#8b5cf6' → 'var(--color-accent-purple)'
'#06b6d4' → 'var(--color-accent-cyan)'
'#f97316' → 'var(--color-accent-orange)'
```

For ENUM_COLORS (line 193), use accent palette tokens:
```tsx
const ENUM_COLORS = [
  'var(--color-info)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-error)',
  'var(--color-accent-purple)',
  'var(--color-accent-cyan)',
  'var(--color-accent-orange)',
];
```

Note: If these colors are used as Recharts `fill`/`stroke` props, they need `resolveColor()`. Check each usage. If they're used in inline `style` props or Tailwind classes, CSS vars work directly.

- [ ] **Step 2: Fix CustomNarrative.tsx**

Replace SEVERITY_COLORS (lines 3-8):
```tsx
const SEVERITY_COLORS: Record<string, string> = {
  critical: 'var(--color-error)',
  high: 'var(--color-warning)',
  medium: 'var(--color-info)',
  low: 'var(--color-verdict-na)',
};
```

Replace fallback (line 46): `?? '#6b7280'` → `?? 'var(--color-verdict-na)'`

- [ ] **Step 3: Fix ReportTab.tsx**

Replace REPORT_VARIANT_THEMES hex colors (lines 36-49):
```tsx
const REPORT_VARIANT_THEMES: Record<string, ReportVariantTheme> = {
  'kaira-run-v1': {
    accent: 'var(--color-accent-teal)',
    accentMuted: 'var(--surface-success)',
  },
  'inside-sales-run-v1': {
    accent: 'var(--color-accent-purple)',
    accentMuted: 'var(--surface-brand-subtle)',
  },
  'voice-rx-run-v1': {
    accent: 'var(--color-error)',
    accentMuted: 'var(--surface-error)',
  },
};
```

Replace gradient hex (line 95-96): `#111827` → `var(--color-neutral-800)`, `#0f172a` → `var(--color-neutral-900)`.

- [ ] **Step 4: Verify build**

Run: `npx tsc -b && npm run build`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: replace hardcoded hex in EvaluatorCard, CustomNarrative, and ReportTab"
```

---

### Task 9: Color sweep — report stragglers

**Files:**
- Modify: `src/features/evalRuns/components/report/PromptGapAnalysis.tsx`
- Modify: `src/features/evalRuns/components/report/RuleComplianceTable.tsx`
- Modify: `src/features/evalRuns/components/report/FrictionAnalysis.tsx`
- Modify: `src/features/evalRuns/components/report/VerdictDistributions.tsx`
- Modify: `src/components/report/ComplianceGatesPanel.tsx`
- Modify: `src/components/report/DimensionBreakdownChart.tsx`

- [ ] **Step 1: Fix PromptGapAnalysis.tsx**

Replace fallback hex (lines 62, 92, 139):
```tsx
// Old:
?? '#6b7280'
// New:
?? 'var(--color-verdict-na)'
```

- [ ] **Step 2: Fix RuleComplianceTable.tsx**

Replace chart data hex (lines 34-36):
```tsx
{ label: `≥80%: ${goodCount} rules`, value: goodCount, color: 'var(--color-success)' },
{ label: `50–79%: ${mediumCount} rules`, value: mediumCount, color: 'var(--color-warning)' },
{ label: `<50%: ${badCount} rules`, value: badCount, color: 'var(--color-error)' },
```

Replace fallback (line 87): `?? '#6b7280'` → `?? 'var(--color-verdict-na)'`

Note: If these `color` values feed into Recharts, wrap with `resolveColor()`.

- [ ] **Step 3: Fix FrictionAnalysis.tsx**

Replace CAUSE_COLORS (lines 15-18):
```tsx
const CAUSE_COLORS: Record<string, string> = {
  bot: 'var(--color-error)',
  user: 'var(--color-info)',
};
```

Replace hardcoded Tailwind colors (line 73, 81):
```tsx
// Old:
<span className="text-lg font-extrabold text-red-500">
<span className="text-lg font-extrabold text-blue-500">
// New:
<span className="text-lg font-extrabold text-[var(--color-error)]">
<span className="text-lg font-extrabold text-[var(--color-info)]">
```

- [ ] **Step 4: Fix VerdictDistributions.tsx**

Replace intent accuracy hex (lines 45-49):
```tsx
{ label: 'High (≥80%)', value: high, color: 'var(--color-success)' },
{ label: 'Medium (50–79%)', value: medium, color: 'var(--color-warning)' },
{ label: 'Low (<50%)', value: low, color: 'var(--color-error)' },
```

Replace fallbacks (lines 101, 122):
```tsx
// Old:
?? '#16a34a'
?? '#6b7280'
// New:
?? 'var(--color-verdict-pass)'
?? 'var(--color-verdict-na)'
```

- [ ] **Step 5: Fix ComplianceGatesPanel.tsx**

Replace fallback hex in gateColor function (lines 17-19):
```tsx
// Old:
if (rate >= 95) return 'var(--color-success, #22c55e)';
if (rate >= 85) return 'var(--color-warning, #eab308)';
return 'var(--color-error, #ef4444)';
// New (remove hex fallbacks — vars are always defined):
if (rate >= 95) return 'var(--color-success)';
if (rate >= 85) return 'var(--color-warning)';
return 'var(--color-error)';
```

- [ ] **Step 6: Fix DimensionBreakdownChart.tsx**

Same pattern as ComplianceGatesPanel (lines 18-20):
```tsx
if (avg >= green) return 'var(--color-success)';
if (avg >= yellow) return 'var(--color-warning)';
return 'var(--color-error)';
```

- [ ] **Step 7: Verify build**

Run: `npx tsc -b && npm run build`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "fix: replace hardcoded hex in remaining report components"
```

---

### Task 10: Color sweep — guide components

**Files:**
- Modify: `src/features/guide/components/Badge.tsx`
- Modify: `src/features/guide/components/CodeBlock.tsx`
- Modify: `src/features/guide/components/StepperFlow.tsx`
- Modify: `src/features/guide/pages/DbApiRef.tsx`
- Modify: `src/features/guide/pages/UsersTenants.tsx` (non-Mermaid lines only)
- Modify: `src/features/guide/pages/ApiExplorer.tsx`

- [ ] **Step 1: Fix Badge.tsx (lines 3-9)**

Replace the hardcoded colorStyles with CSS variable-based tokens. Since this is the guide's Badge (not the main UI Badge), use semantic surface tokens:

```tsx
const colorStyles: Record<string, string> = {
  blue: 'bg-[var(--surface-info)] text-[var(--color-info)]',
  green: 'bg-[var(--surface-success)] text-[var(--color-success)]',
  purple: 'bg-[var(--surface-brand-subtle)] text-[var(--text-brand)]',
  amber: 'bg-[var(--surface-warning)] text-[var(--color-warning)]',
  red: 'bg-[var(--surface-error)] text-[var(--color-error)]',
};
```

Update the component to use `className` instead of inline `style`:
```tsx
<span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', colorStyles[color] ?? colorStyles.blue)}>
```

- [ ] **Step 2: Fix CodeBlock.tsx (line 42)**

```tsx
// Old:
color: "#94a3b8",
// New:
color: "var(--text-muted)",
```

- [ ] **Step 3: Fix StepperFlow.tsx (line 19)**

```tsx
// Old:
color: "#ffffff"
// New:
color: "var(--text-on-color)"
```

- [ ] **Step 4: Fix DbApiRef.tsx HTTP method colors (lines 176-184)**

```tsx
// Old:
const color =
  method === "GET" ? "#10b981"
    : method === "POST" ? "#3b82f6"
      : method === "PUT" ? "#f59e0b"
        : method === "DELETE" ? "#ef4444"
          : "var(--text-secondary)";
// New:
const color =
  method === "GET" ? "var(--color-http-get)"
    : method === "POST" ? "var(--color-http-post)"
      : method === "PUT" ? "var(--color-http-put)"
        : method === "DELETE" ? "var(--color-http-delete)"
          : "var(--text-secondary)";
```

- [ ] **Step 5: Fix UsersTenants.tsx HTTP method colors (non-Mermaid)**

Find the HTTP method color mapping outside of Mermaid template strings and replace with `var(--color-http-*)` tokens. Leave Mermaid `style X fill:#...` lines unchanged (justified exception).

- [ ] **Step 6: Fix ApiExplorer.tsx**

Replace any hardcoded hex colors with the appropriate CSS variable tokens.

- [ ] **Step 7: Verify build**

Run: `npx tsc -b && npm run build`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "fix: replace hardcoded hex in guide components with design tokens"
```

---

### Task 11: Fix StarToggle and PasswordStrengthIndicator

**Files:**
- Modify: `src/components/ui/StarToggle.tsx`
- Modify: `src/components/ui/PasswordStrengthIndicator.tsx`

- [ ] **Step 1: Fix StarToggle.tsx**

Replace hardcoded Tailwind amber colors (lines 25-27):
```tsx
// Old:
checked
  ? 'border-amber-400/40 bg-amber-500/10 text-amber-500'
  : 'border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-amber-500',
// New:
checked
  ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
  : 'border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--color-warning)]',
```

- [ ] **Step 2: Fix PasswordStrengthIndicator.tsx**

Replace strengthColor (lines 39-43):
```tsx
const strengthColor =
  strength <= 0.4 ? 'bg-[var(--color-error)]' :
  strength <= 0.6 ? 'bg-[var(--color-warning)]' :
  strength < 1 ? 'bg-[var(--color-warning)]' :
  'bg-[var(--color-success)]';
```

Replace textColor (lines 45-49):
```tsx
const textColor =
  strength <= 0.4 ? 'text-[var(--color-error)]' :
  strength <= 0.6 ? 'text-[var(--color-warning)]' :
  strength < 1 ? 'text-[var(--color-warning)]' :
  'text-[var(--color-success)]';
```

Replace rule chip colors (lines 75-77):
```tsx
// Old:
passed ? 'bg-green-500/10 text-green-400' : ...
// New:
passed ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]' : ...
```

- [ ] **Step 3: Verify build**

Run: `npx tsc -b && npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/StarToggle.tsx src/components/ui/PasswordStrengthIndicator.tsx
git commit -m "fix: replace hardcoded Tailwind colors in StarToggle and PasswordStrengthIndicator"
```

---

### Task 12: Z-index sweep — overlay components

**Files:**
- Modify: `src/features/settings/components/SchemaCreateOverlay.tsx`
- Modify: `src/features/settings/components/PromptCreateOverlay.tsx`
- Modify: `src/features/settings/components/SettingsSlideOver.tsx`
- Modify: `src/features/settings/components/ReadOnlyViewOverlay.tsx`
- Modify: `src/features/kaira/components/ApiDebugOverlay.tsx`
- Modify: `src/features/insideSales/components/CallFilterPanel.tsx`
- Modify: `src/features/insideSales/components/SelectCallsStep.tsx`
- Modify: `src/features/evalRuns/components/EvaluatorPreviewOverlay.tsx`

- [ ] **Step 1: Replace z-index in all overlay backdrops and panels**

Apply this mapping consistently:

| Old class | New class | Usage |
|-----------|-----------|-------|
| `z-[100]` | `z-[var(--z-overlay)]` | Overlay backdrops |
| `z-[101]` | `z-[calc(var(--z-overlay)+1)]` | Overlay content panels |
| `z-50` | `z-[var(--z-dropdown)]` | Filter panels (CallFilterPanel) |
| `z-[60]` | `z-[var(--z-dropdown)]` | Side panels (SelectCallsStep, EvaluatorPreviewOverlay) |

For each file, find the z-index classes and replace:

**SchemaCreateOverlay.tsx** (lines 336, 341):
```tsx
// Old:
className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-[2px]"
className="fixed inset-y-0 right-0 z-[101] w-[60vw] ...
// New:
className="fixed inset-0 z-[var(--z-overlay)] bg-black/30 backdrop-blur-[2px]"
className="fixed inset-y-0 right-0 z-[calc(var(--z-overlay)+1)] w-[60vw] ...
```

Apply the same pattern to: `PromptCreateOverlay.tsx`, `SettingsSlideOver.tsx`, `ReadOnlyViewOverlay.tsx`, `ApiDebugOverlay.tsx`.

**CallFilterPanel.tsx** (line 62):
```tsx
// Old:
className="fixed inset-0 z-50"
// New:
className="fixed inset-0 z-[var(--z-dropdown)]"
```

**SelectCallsStep.tsx** (line 83):
```tsx
// Old:
className="fixed inset-0 z-[60]"
// New:
className="fixed inset-0 z-[var(--z-dropdown)]"
```

**EvaluatorPreviewOverlay.tsx** (line 368):
```tsx
// Old:
className="fixed inset-0 z-[60] flex"
// New:
className="fixed inset-0 z-[var(--z-overlay)] flex"
```

- [ ] **Step 2: Verify build**

Run: `npx tsc -b && npm run build`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix: replace arbitrary z-index values with design system tokens in overlays"
```

---

### Task 13: Delete old select components

**Files:**
- Delete: `src/components/ui/SingleSelect.tsx`
- Delete: `src/components/ui/SearchableSelect.tsx`
- Delete: `src/components/ui/MultiSelect.tsx`
- Modify: `src/components/ui/index.ts`

- [ ] **Step 1: Verify no remaining imports of old components**

Run these three checks:
```bash
grep -r 'SingleSelect' src/ --include='*.tsx' --include='*.ts' | grep -v 'node_modules' | grep -v '.test.'
grep -r 'SearchableSelect' src/ --include='*.tsx' --include='*.ts' | grep -v 'node_modules' | grep -v '.test.'
grep -r 'MultiSelect' src/ --include='*.tsx' --include='*.ts' | grep -v 'node_modules' | grep -v '.test.'
```

Expected: Only hits in `src/components/ui/index.ts` and the component files themselves.

- [ ] **Step 2: Remove exports from index.ts**

Remove these three lines from `src/components/ui/index.ts`:
```ts
export { SearchableSelect, type SearchableSelectOption } from './SearchableSelect';
export { SingleSelect, type SingleSelectOption } from './SingleSelect';
export { MultiSelect, type MultiSelectOption } from './MultiSelect';
```

- [ ] **Step 3: Delete old component files**

```bash
rm src/components/ui/SingleSelect.tsx
rm src/components/ui/SearchableSelect.tsx
rm src/components/ui/MultiSelect.tsx
```

- [ ] **Step 4: Delete guide FilterPills re-export**

```bash
rm src/features/guide/components/FilterPills.tsx
```

Update any guide imports that still reference it to import from `@/components/ui` instead.

- [ ] **Step 5: Verify build**

Run: `npx tsc -b && npm run build`
Expected: No errors. All consumers already migrated.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete old SingleSelect, SearchableSelect, MultiSelect, and guide FilterPills"
```

---

### Task 14: FilterPills migration for RunList and EvaluatorsTable (optional)

**Note:** The RunList type/status filter chips include colored dot indicators per option (e.g., colored dots for batch/adversarial/thread types). The basic `FilterPills` component doesn't support dot/icon indicators. Two options:

1. **Extend FilterPills** with an optional `dot?: string` (CSS color) or `icon?: ReactNode` field on each option, then migrate.
2. **Leave these as-is** — they're already using design system tokens for colors (`var(--surface-info)`, `var(--border-info)`, etc.) and are only 2 instances. The ROI of forcing them into FilterPills is low.

**Recommendation:** Option 2 — skip this migration. The inline pill implementations in RunList and EvaluatorsTable already use design system tokens. Focus enforcement on no-hardcoded-colors rule rather than forcing component adoption for complex variants.

---

### Task 15: Phase 2 final verification

- [ ] **Step 1: Full build check**

Run: `npm run build && npm run lint && npx tsc -b`
Expected: Zero errors.

- [ ] **Step 2: Scan for remaining violations**

```bash
# Hardcoded hex (should only show justified exceptions)
grep -rn '#[0-9a-fA-F]\{3,8\}' src/ --include='*.tsx' | grep -v 'node_modules' | grep -v 'globals.css' | grep -v 'statusColors.ts' | grep -v 'guide.css'

# Arbitrary z-index (should be zero)
grep -rn 'z-\[[0-9]' src/ --include='*.tsx' | grep -v 'node_modules'

# Native select elements (should be zero)
grep -rn '<select' src/ --include='*.tsx' | grep -v 'node_modules'

# Old component imports (should be zero)
grep -rn 'SingleSelect\|SearchableSelect\|MultiSelect' src/ --include='*.tsx' --include='*.ts' | grep -v 'node_modules'
```

- [ ] **Step 3: Document any remaining justified exceptions**

Record any hex colors that legitimately remain (Mermaid diagrams, D3 configs). These will be documented in Phase 3.

- [ ] **Step 4: Commit scan results if any fixes were needed**

Branch is ready for merge to main before Phase 3.
