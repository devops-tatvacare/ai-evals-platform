# Design System Cleanup — Specification

**Date:** 2026-04-07
**Status:** Approved
**Scope:** Frontend design tokens, UI component library, hardcoded value elimination

---

## Problem Statement

The platform has a well-architected design token system in `src/styles/globals.css` (261 tokens, full light/dark mode) but ~15-20% of components bypass it entirely. This creates:

- **350+ unjustified hardcoded styling values** across 26+ files
- **3 incompatible select/dropdown implementations** plus 12+ native HTML `<select>` usages
- **6+ copy-pasted pagination implementations** with no shared component
- **3 conflicting z-index tiers** (10, 60, 100, 9999) with no strategy
- **A parallel report color system** (`report/shared/colors.ts`) that duplicates token values as hex

The token layer is ready to scale; the component consumption isn't consistently wired to it.

---

## Architecture Decisions

### Token Layer

**Extend `globals.css`** with missing tokens rather than creating new files:

| Category | New Tokens | Rationale |
|----------|-----------|-----------|
| Z-index scale | `--z-base(1)`, `--z-sticky(10)`, `--z-dropdown(50)`, `--z-overlay(100)`, `--z-modal(200)`, `--z-tooltip(300)`, `--z-max(999)` | Replace 3 conflicting tiers with one scale |
| HTTP method colors | `--color-http-get`, `--color-http-post`, `--color-http-put`, `--color-http-patch`, `--color-http-delete` | Used in guide pages, currently hardcoded in 3 files |
| Chart palette | Formalize existing `--color-accent-*` as canonical chart palette | D3/Recharts need resolved hex — `resolveColor()` bridges this |

**Remove or wire unused tokens:**
- `--text-xs` through `--text-xl` are defined but never consumed (Tailwind utilities handle typography). Either map them into Tailwind's `@theme` font-size scale or remove.
- `--spacing-*` tokens are similarly unused directly — Tailwind's spacing utilities are the consumption layer. Keep them in `@theme` since Tailwind v4 reads them automatically.

**JS color abstraction consolidation:**
- `statusColors.ts` remains the single JS-side color registry (CSS var strings + `resolveColor()` for canvas/chart libs)
- `report/shared/colors.ts` hex maps get replaced with `resolveColor()` calls against CSS vars
- `evalColors.ts` re-export stays as convenience import

### Component Library — Radix Consolidation

**New `<Select>` component** (replaces `SingleSelect.tsx`):
- Wraps `@radix-ui/react-select`
- Props: `value`, `onChange`, `options: {value, label}[]`, `placeholder?`, `size?: 'sm' | 'md'`, `disabled?`, `className?`
- Keyboard nav, portal positioning, ARIA compliance from Radix
- Styled with design system tokens (no hardcoded colors)

**New `<Combobox>` component** (replaces `SearchableSelect.tsx` + `MultiSelect.tsx`):
- Wraps `@radix-ui/react-popover` + custom search input (Radix doesn't ship a stable Combobox)
- Props: `value?: string`, `values?: string[]`, `onChange`, `options`, `searchable?: boolean`, `multi?: boolean`, `placeholder?`, `size?`, `disabled?`, `className?`
- Single component handles both single-search and multi-search via `multi` prop
- Portal-based dropdown, viewport-aware positioning, keyboard nav
- Search filtering, checkbox indicators for multi, clear button

**New `<Pagination>` component:**
- Props: `page`, `totalPages`, `onPageChange`, `showCount?`, `totalItems?`, `pageSize?`
- Renders Previous/Next buttons, "Page X of Y", optional "Showing X–Y of Z"
- Styled consistently with design tokens

**`<FilterPills>` promoted to `src/components/ui/`:**
- Move from `src/features/guide/components/FilterPills.tsx`
- Props: `options: {id, label}[]`, `active: string`, `onChange: (id) => void`
- Replace ad-hoc inline pill buttons in RunList, EvaluatorsTable

**Existing components — fixes only:**
- `StarToggle.tsx`: amber-500 → `var(--color-warning)`
- `PasswordStrengthIndicator.tsx`: red-500/green-500 → `var(--color-error)`/`var(--color-success)`
- All UI primitives (Tooltip, Popover, Modal, SplitButton): z-index → token values

### Enforcement Rules

After cleanup, these rules are mandatory:

1. **No `#` hex literals in `.tsx` files** outside `globals.css` and `statusColors.ts`
2. **No `z-[N]` arbitrary values** — use z-index tokens
3. **No inline `style={{ color/background/fontSize }}`** unless dynamically computed (depth-based indentation, calculated positioning)
4. **No native HTML `<select>`** — use `<Select>` or `<Combobox>`
5. **No copy-pasted pagination** — use `<Pagination>`
6. **Justified exceptions:** D3 visualization configs, Mermaid template strings, print-specific CSS in `report-print.css`

---

## Phase 1 — Foundation

**Branch:** `feat/phase-1-design-system-foundation`
**Goal:** Build the new token layer and components. Old components still work.

### 1.1 Token Extension

**File:** `src/styles/globals.css`

Add to `@theme` block:
```css
/* Z-index scale */
--z-base: 1;
--z-sticky: 10;
--z-dropdown: 50;
--z-overlay: 100;
--z-modal: 200;
--z-tooltip: 300;
--z-max: 999;

/* HTTP method colors */
--color-http-get: #10b981;
--color-http-post: #6366f1;
--color-http-put: #8b5cf6;
--color-http-patch: #f59e0b;
--color-http-delete: #ef4444;
```

Add dark mode overrides for HTTP method colors in `[data-theme="dark"]` if contrast requires adjustment.

Audit typography tokens (`--text-xs` through `--text-xl`): confirm Tailwind v4 auto-reads them from `@theme`. If yes, keep. If not consumed anywhere, remove to avoid confusion.

### 1.2 New Select Component

**File:** `src/components/ui/Select.tsx`

- Wrap `@radix-ui/react-select` (already a dependency)
- Two sizes: `sm` (h-8 text-xs) and `md` (h-9 text-sm)
- Use z-index token `var(--z-dropdown)` for portal
- Export `Select`, `SelectOption` type from `index.ts`

### 1.3 New Combobox Component

**File:** `src/components/ui/Combobox.tsx`

- Install `@radix-ui/react-popover` (already a dependency) as positioning layer
- Internal search input with clear button
- `multi` prop toggles between single-value and multi-value behavior
- Multi mode: checkbox indicators, "N selected" display, clear-all button
- Use z-index token for portal
- Export `Combobox`, `ComboboxOption` type from `index.ts`

### 1.4 New Pagination Component

**File:** `src/components/ui/Pagination.tsx`

- Previous/Next buttons using `<Button variant="ghost" size="sm">`
- "Page X of Y" center text
- Optional "Showing X–Y of Z" when `showCount` + `totalItems` + `pageSize` provided
- Disable Previous on page 1, Next on last page
- Export from `index.ts`

### 1.5 Promote FilterPills

- Move `src/features/guide/components/FilterPills.tsx` → `src/components/ui/FilterPills.tsx`
- Remove hardcoded `#ffffff` color, use `var(--text-on-color)` instead
- Update guide imports to point to new location
- Export from `index.ts`

### 1.6 Z-index Token Migration in UI Primitives

Update these files to use z-index tokens:
- `src/components/ui/Tooltip.tsx`: `z-[9999]` → `z-[var(--z-tooltip)]`
- `src/components/ui/Popover.tsx`: `z-[9999]` → `z-[var(--z-dropdown)]`
- `src/components/ui/Modal.tsx`: `z-50` → `z-[var(--z-modal)]`
- `src/components/ui/SplitButton.tsx`: dropdown z-index → `var(--z-dropdown)`

### 1.7 Report Colors Consolidation

**File:** `src/features/evalRuns/components/report/shared/colors.ts`

- Replace `VERDICT_COLORS` hex map with `resolveColor('var(--color-verdict-*)')` calls
- Replace `SEVERITY_COLORS`, `DIFFICULTY_COLORS` hex values similarly
- Keep `METRIC_COLOR` threshold function but return resolved CSS vars
- Ensure `useResolvedColor.ts` hook is used in chart components that need hex at render time

### 1.8 Exit Criteria

- [ ] New tokens in `globals.css` (z-index, HTTP method colors)
- [ ] `<Select>` component works with same API as old `SingleSelect`
- [ ] `<Combobox>` component works in single and multi mode
- [ ] `<Pagination>` component renders correctly
- [ ] `<FilterPills>` in `src/components/ui/`
- [ ] UI primitives use z-index tokens
- [ ] `report/shared/colors.ts` uses `resolveColor()` instead of hex
- [ ] `npm run build && npx tsc -b` passes
- [ ] Old components (`SingleSelect`, `SearchableSelect`, `MultiSelect`) still exist and work

---

## Phase 2 — Sweep

**Branch:** `feat/phase-2-design-system-sweep`
**Goal:** Migrate every consumer. Remove all hardcoded values. Delete old components.

### 2.1 Select Consumer Migration

Replace all native `<select>` and old select components:

| File | Current | Target |
|------|---------|--------|
| `settings/SchemaSelector.tsx` | Native `<select>` | `<Select>` |
| `settings/PromptSelector.tsx` | Native `<select>` | `<Select>` |
| `settings/SchemaEditor.tsx` | Native `<select>` | `<Select>` |
| `settings/SchemaTable.tsx` (inline) | Native `<select>` | `<Select size="sm">` |
| `settings/ModelSelector.tsx` | Custom dropdown | Compose `<Combobox searchable>` internally |
| `admin/CreateUserDialog.tsx` | Native `<select>` | `<Select>` |
| `admin/EditUserDialog.tsx` | Native `<select>` | `<Select>` |
| `csvImport/CsvFieldMapper.tsx` | Native `<select>` | `<Select>` |
| `evals/OutputSchemaBuilder.tsx` | Native `<select>` | `<Select>` |
| `evals/InlineSchemaBuilder.tsx` | Native `<select>` | `<Select>` |
| `evals/ArrayItemConfigModal.tsx` | Native `<select>` | `<Select>` |
| `evalRuns/ThreadDetailV2.tsx` | Native `<select>` | `<Select>` |
| All `SingleSelect` consumers | `SingleSelect` | `<Select>` |
| All `SearchableSelect` consumers | `SearchableSelect` | `<Combobox searchable>` |
| All `MultiSelect` consumers | `MultiSelect` | `<Combobox multi searchable>` |

### 2.2 Pagination Consumer Migration

| File | Current Pattern | Target |
|------|----------------|--------|
| `admin/AdminUsersPage.tsx` | Inline Previous/Next + slice | `<Pagination>` |
| `admin/InviteLinksSection.tsx` | Inline Previous/Next + "Showing X–Y" | `<Pagination showCount>` |
| `evalRuns/pages/RunList.tsx` | Inline Previous/Next + page state | `<Pagination>` |
| `evalRuns/EvalTable.tsx` | Inline Previous/Next + sorting | `<Pagination>` |
| `evalRuns/AdversarialTable.tsx` | Inline count + Previous/Next | `<Pagination showCount>` |
| `evals/EvaluatorHistoryListOverlay.tsx` | Load-more button | Keep as-is (infinite scroll, different pattern) |

### 2.3 FilterPills Consumer Migration

| File | Current Pattern | Target |
|------|----------------|--------|
| `evalRuns/pages/RunList.tsx` | Inline pill buttons for type/status | `<FilterPills>` |
| `evals/EvaluatorsTable.tsx` | Inline filter toggle buttons | `<FilterPills>` |
| Guide pages | Already use FilterPills | Update import path |

### 2.4 Color Sweep — Critical Files

| File | Issues | Fix |
|------|--------|-----|
| `report/sectionInfo.tsx` | 50 hex instances | Map all colors to `var(--color-verdict-*)`, `var(--priority-p*-accent)`, `var(--color-level-*)` |
| `report/KairaReportView.tsx` | 25 hex + 31 px values | Replace hex with CSS vars. Replace inline px with Tailwind classes. Extract print-specific styles to CSS classes in `report-print.css` |
| `report/PlatformReportRenderer.tsx` | 8 hex values | Replace with CSS vars. Move inline styles to Tailwind classes |
| `report/ReportTab.tsx` | 6 hex values | Replace with CSS vars or semantic tokens |
| `report/customEval/EvaluatorCard.tsx` | 12 color defs | Replace ENUM_COLORS array with accent palette tokens |
| `report/customEval/CustomNarrative.tsx` | 4 severity colors | Replace with verdict color tokens |

### 2.5 Color Sweep — Medium Files

| File | Issues | Fix |
|------|--------|-----|
| `guide/components/Badge.tsx` | 20 hardcoded colors (5 palettes × 4 props) | Replace with CSS vars for bg/text, use `[data-theme="dark"]` selectors |
| `guide/components/CodeBlock.tsx` | 1 hardcoded `#94a3b8` | → `var(--text-muted)` |
| `guide/components/StepperFlow.tsx` | 1 hardcoded `#ffffff` | → `var(--text-on-color)` |
| `guide/pages/DbApiRef.tsx` | 4 HTTP method colors | → `var(--color-http-*)` tokens |
| `guide/pages/UsersTenants.tsx` | 5 HTTP method colors | → `var(--color-http-*)` tokens |
| `guide/pages/ApiExplorer.tsx` | 2 hardcoded colors | → CSS vars |
| `ui/PasswordStrengthIndicator.tsx` | red-500/green-500 | → `text-[var(--color-error)]`/`text-[var(--color-success)]` |
| `ui/StarToggle.tsx` | amber-500 | → `text-[var(--color-warning)]` |

### 2.6 Color Sweep — Report Stragglers

| File | Issues | Fix |
|------|--------|-----|
| `report/PromptGapAnalysis.tsx` | 3 fallback `?? '#6b7280'` | → `?? 'var(--text-muted)'` |
| `report/RuleComplianceTable.tsx` | 4 hardcoded colors | → verdict/semantic tokens |
| `report/FrictionAnalysis.tsx` | 2 CAUSE_COLORS | → CSS vars |
| `report/VerdictDistributions.tsx` | 3 status colors | → CSS vars |
| `components/report/ComplianceGatesPanel.tsx` | 3 fallback colors | → CSS vars |
| `components/report/DimensionBreakdownChart.tsx` | 3 fallback colors | → CSS vars |

### 2.7 Z-index Sweep — Overlay Components

| File | Current | Target |
|------|---------|--------|
| `settings/SchemaCreateOverlay.tsx` | `z-[100]`, `z-[101]` | `z-[var(--z-overlay)]`, content gets +1 via CSS |
| `settings/PromptCreateOverlay.tsx` | `z-[100]`, `z-[101]` | Same |
| `settings/SettingsSlideOver.tsx` | `z-[100]`, `z-[101]` | Same |
| `settings/ReadOnlyViewOverlay.tsx` | `z-[100]`, `z-[101]` | Same |
| `kaira/ApiDebugOverlay.tsx` | `z-[60]`, `z-[100]` | `z-[var(--z-dropdown)]`, `z-[var(--z-overlay)]` |
| `insideSales/CallFilterPanel.tsx` | `z-50` | `z-[var(--z-dropdown)]` |
| `insideSales/SelectCallsStep.tsx` | `z-[60]` | `z-[var(--z-dropdown)]` |
| `evalRuns/EvaluatorPreviewOverlay.tsx` | arbitrary z | Token value |

### 2.8 Delete Old Components

After all consumers are migrated:
- Delete `src/components/ui/SingleSelect.tsx`
- Delete `src/components/ui/SearchableSelect.tsx`
- Delete `src/components/ui/MultiSelect.tsx`
- Remove from `src/components/ui/index.ts`
- Remove `src/features/guide/components/FilterPills.tsx` (moved to ui/)

### 2.9 Exit Criteria

- [ ] Zero native `<select>` elements in `.tsx` files
- [ ] Zero imports of `SingleSelect`, `SearchableSelect`, `MultiSelect`
- [ ] Zero hardcoded hex colors in `.tsx` files (excluding justified exceptions)
- [ ] Zero arbitrary z-index values
- [ ] All pagination uses `<Pagination>` component
- [ ] `npm run build && npx tsc -b && npm run lint` passes

---

## Phase 3 — Verify + Document

**Branch:** `feat/phase-3-design-system-docs`
**Goal:** Prove the cleanup is complete. Document rules for future contributors.

### 3.1 Full Sweep Scan

Run these greps across all `.tsx` files and document results:

```bash
# Hardcoded hex colors
rg '#[0-9a-fA-F]{3,8}' --type tsx -l

# Arbitrary z-index
rg 'z-\[\d+\]' --type tsx -l

# Inline color/background/fontSize styles
rg 'style=\{.*?(color|background|fontSize)' --type tsx -l

# Native select elements
rg '<select' --type tsx -l
```

Any remaining hits must be justified (D3, Mermaid, print CSS, dynamic computation) and documented.

### 3.2 Visual Regression Check

Walk through every major view in both light and dark mode:
- VoiceRx: upload, listing detail, eval run, report
- Kaira: chat, trace analysis, eval run, report
- InsideSales: call list, call detail, eval run, report
- Settings: prompts, schemas, LLM config, evaluators
- Admin: users, invite links, roles
- Guide: all pages

Confirm: colors correct, dropdowns functional, pagination works, z-index layering correct (modals above overlays above dropdowns above content).

### 3.3 Build Verification

```bash
npm run build
npm run lint
npx tsc -b
```

Zero errors, zero warnings related to design system changes.

### 3.4 Documentation Updates

**Update `CLAUDE.md`** — add to Frontend Rules section:

```markdown
## Design System Rules

- All colors must use CSS variables from `src/styles/globals.css`. No hex literals in `.tsx` files.
- Z-index must use tokens: `--z-base(1)`, `--z-sticky(10)`, `--z-dropdown(50)`, `--z-overlay(100)`, `--z-modal(200)`, `--z-tooltip(300)`.
- Use `<Select>` for simple dropdowns, `<Combobox>` for searchable/multi-select. No native `<select>`.
- Use `<Pagination>` for all paginated lists. No copy-pasting Previous/Next buttons.
- Use `<FilterPills>` for filter toggle groups.
- For chart/canvas libraries that need hex values, use `resolveColor()` from `statusColors.ts`.
- Justified exceptions: D3 visualization configs, Mermaid template strings, `report-print.css`.
```

**Update `.github/copilot-instructions.md`** with the same rules.

**Add `src/components/ui/README.md`** — component catalog with props, usage examples, and when to use each component.

### 3.5 Exit Criteria

- [ ] Sweep scan shows zero unjustified violations
- [ ] All views verified in light + dark mode
- [ ] Clean build, lint, typecheck
- [ ] Rules documented in `CLAUDE.md`, `.github/copilot-instructions.md`
- [ ] Component catalog in `src/components/ui/README.md`

---

## Justified Exceptions (Do Not Refactor)

| Context | Files | Reason |
|---------|-------|--------|
| Mermaid diagram syntax | `Pipelines.tsx`, `UsersTenants.tsx` | Mermaid requires inline `fill:` and `color:` in diagram definitions |
| D3 visualization configs | `brainMap.ts`, `BrainMap.tsx` | D3 operates on DOM outside React, can't read CSS vars at definition time (use `resolveColor()` where possible) |
| Recharts cell colors | Various chart components | Recharts props need hex — use `resolveColor()` |
| Print stylesheet | `report-print.css` | Print-specific overrides are standard CSS practice |
| Depth-based indentation | `EnhancedJsonViewer.tsx`, `ExtractedDataPane.tsx` | `paddingLeft: depth * 16` is computed, not hardcoded |

---

## Risk Mitigation

- **Phase 1 is additive.** New components alongside old ones. No breakage.
- **Phase 2 is file-by-file.** Each migration is isolated. If a consumer breaks, revert that file.
- **Radix dependency risk:** Already using `@radix-ui/react-select` and `@radix-ui/react-switch`. Adding `@radix-ui/react-popover` (already a dependency) is low risk.
- **Print reports:** KairaReportView and PlatformReportRenderer use inline styles for PDF rendering. Move to CSS classes in `report-print.css` and test print output.
