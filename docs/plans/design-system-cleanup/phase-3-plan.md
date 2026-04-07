# Phase 3 — Verify + Document

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove cleanup is complete via automated scans, verify visual correctness, and document mandatory design system rules for future contributors.

**Architecture:** No code changes except for any remaining violations found during scanning. All work is verification and documentation.

**Tech Stack:** Same as Phase 1/2.

**Spec:** `docs/plans/design-system-cleanup/spec.md`

**Prerequisite:** Phase 2 merged to main. Branch from main: `feat/phase-3-design-system-docs`

---

### Task 1: Full automated sweep scan

**Files:**
- None modified (scan only)

- [ ] **Step 1: Scan for hardcoded hex colors**

Run:
```bash
grep -rn '#[0-9a-fA-F]\{3,8\}' src/ --include='*.tsx' --include='*.ts' | grep -v 'node_modules' | grep -v 'globals.css' | grep -v 'statusColors.ts' | grep -v 'guide.css' | grep -v 'report-print.css' | grep -v '.test.'
```

Expected: Only hits in justified exception files (Mermaid template strings in Pipelines.tsx, UsersTenants.tsx; D3 configs in brainMap.ts). Record each hit.

- [ ] **Step 2: Scan for arbitrary z-index values**

Run:
```bash
grep -rn 'z-\[[0-9]' src/ --include='*.tsx' | grep -v 'node_modules'
grep -rn 'zIndex:.*[0-9]' src/ --include='*.tsx' | grep -v 'node_modules'
```

Expected: Zero results. All z-index values should use `var(--z-*)` tokens.

- [ ] **Step 3: Scan for native select elements**

Run:
```bash
grep -rn '<select' src/ --include='*.tsx' | grep -v 'node_modules'
```

Expected: Zero results.

- [ ] **Step 4: Scan for old component imports**

Run:
```bash
grep -rn 'SingleSelect\|SearchableSelect\|MultiSelect' src/ --include='*.tsx' --include='*.ts' | grep -v 'node_modules'
```

Expected: Zero results.

- [ ] **Step 5: Scan for inline style color/background/fontSize**

Run:
```bash
grep -rn "style={{" src/ --include='*.tsx' | grep -v 'node_modules' | grep -E 'color:|background:|fontSize:' | grep -v 'var(--' | grep -v 'depth\|paddingLeft\|maxHeight\|width\|height\|left\|top\|position\|transform\|opacity'
```

Expected: Only hits in justified contexts (dynamically computed styles, print layouts that were moved to CSS).

- [ ] **Step 6: Fix any remaining violations found**

If any unjustified violations are found in steps 1-5, fix them now. Follow the same token-replacement patterns used in Phase 2.

- [ ] **Step 7: Commit fixes if any**

```bash
git add -A
git commit -m "fix: clean up remaining design system violations found during sweep scan"
```

---

### Task 2: Visual regression check

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Walk through VoiceRx flows**

Check in both light and dark mode:
- Upload page
- Listing detail view
- Eval run configuration wizard
- Eval run results / EvalTable
- Report view

Verify: Colors correct, dropdowns functional (Select components work), pagination navigates properly, z-index layering correct (modals above content).

- [ ] **Step 3: Walk through Kaira flows**

Check in both light and dark mode:
- Chat view
- Trace analysis
- Eval run
- Kaira report (KairaReportView)

Verify: Chat colors, report grades, print cover section renders properly.

- [ ] **Step 4: Walk through InsideSales flows**

Check in both light and dark mode:
- Call list with filters (Combobox multi-select for agents, conditions)
- Call detail
- Eval run with SelectCallsStep
- Report / AgentHeatmapTable

Verify: Filter panels open/close correctly, MultiSelect→Combobox works, pagination navigates.

- [ ] **Step 5: Walk through Settings**

Check in both light and dark mode:
- Prompts tab (PromptSelector → Select)
- Schemas tab (SchemaSelector → Select, SchemaEditor → Select)
- LLM config (ModelSelector)
- Evaluators

Verify: All dropdowns work, schema/prompt selection functional.

- [ ] **Step 6: Walk through Admin**

Check in both light and dark mode:
- Users page (pagination, search)
- Invite links (pagination, role select in form)
- Create user dialog (role Select)
- Edit user dialog (role Select)

Verify: Pagination component renders correctly, Select components work in forms.

- [ ] **Step 7: Walk through Guide pages**

Check in both light and dark mode:
- Pages with FilterPills
- Pages with Badge component
- DbApiRef (HTTP method colors)
- Pipelines (Mermaid diagrams — should be unchanged)

Verify: FilterPills toggle correctly, Badge colors match theme, HTTP method colors use tokens.

- [ ] **Step 8: Document any visual issues found**

If any issues are found, fix them and commit.

---

### Task 3: Build verification

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Zero errors, zero warnings related to design system changes.

- [ ] **Step 2: Lint check**

Run: `npm run lint`
Expected: Zero new lint errors.

- [ ] **Step 3: Type check**

Run: `npx tsc -b`
Expected: Zero errors.

- [ ] **Step 4: Commit any fixes**

---

### Task 4: Document design system rules in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Design System Rules section**

In `CLAUDE.md`, after the `## Frontend Rules` section, add:

```markdown
## Design System Rules

- All colors MUST use CSS variables from `src/styles/globals.css`. No hex literals in `.tsx` files.
- The only files allowed to contain hex color values are `src/styles/globals.css`, `src/utils/statusColors.ts`, and `src/features/guide/styles/guide.css`.
- Z-index MUST use tokens: `--z-base(1)`, `--z-sticky(10)`, `--z-dropdown(50)`, `--z-overlay(100)`, `--z-modal(200)`, `--z-tooltip(300)`, `--z-max(999)`.
- Use `<Select>` for simple dropdowns, `<Combobox>` for searchable/multi-select. No native HTML `<select>`.
- Use `<Pagination>` for all paginated lists. No copy-pasting Previous/Next button blocks.
- Use `<FilterPills>` for filter toggle pill groups.
- For chart/canvas libraries (Recharts, D3) that need hex values, use `resolveColor()` from `src/utils/statusColors.ts` or the `useResolvedColor` hook from `src/hooks/useResolvedColor.ts`.
- Justified exceptions that may contain hardcoded colors: D3 visualization configs, Mermaid template strings in guide pages, `report-print.css` print overrides.
- HTTP method colors use `--color-http-get/post/put/patch/delete` tokens.
- Gap type colors use `--color-gap-underspec/silent/leakage/conflicting` tokens.
```

- [ ] **Step 2: Add to Reuse These Abstractions section**

Add to the existing "Reuse These Abstractions" section in `CLAUDE.md`:

```markdown
- Dropdowns -> `Select` from `src/components/ui/Select.tsx`
- Searchable/multi-select -> `Combobox` from `src/components/ui/Combobox.tsx`
- Pagination -> `Pagination` from `src/components/ui/Pagination.tsx`
- Filter pills -> `FilterPills` from `src/components/ui/FilterPills.tsx`
- Chart hex colors -> `resolveColor()` from `src/utils/statusColors.ts`
```

- [ ] **Step 3: Update Current Registry**

Update the component count or registry notes to reflect the new components and deleted old ones.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add mandatory design system rules to CLAUDE.md"
```

---

### Task 5: Update copilot instructions

**Files:**
- Modify: `.github/copilot-instructions.md`

- [ ] **Step 1: Add design system rules**

Add the same design system rules from Task 4 Step 1 to `.github/copilot-instructions.md` in the appropriate section.

- [ ] **Step 2: Commit**

```bash
git add .github/copilot-instructions.md
git commit -m "docs: add design system rules to copilot instructions"
```

---

### Task 6: Create component catalog README

**Files:**
- Create: `src/components/ui/README.md`

- [ ] **Step 1: Write component catalog**

Create `src/components/ui/README.md`:

```markdown
# UI Component Library

Standardized, theme-aware UI primitives. All components use CSS variables from `src/styles/globals.css` and support light/dark mode automatically.

## When to Use What

| Need | Component | Import |
|------|-----------|--------|
| Simple dropdown | `<Select>` | `import { Select } from '@/components/ui'` |
| Searchable dropdown | `<Combobox>` | `import { Combobox } from '@/components/ui'` |
| Multi-select with search | `<Combobox multi>` | `import { Combobox } from '@/components/ui'` |
| Paginated list navigation | `<Pagination>` | `import { Pagination } from '@/components/ui'` |
| Filter toggle pills | `<FilterPills>` | `import { FilterPills } from '@/components/ui'` |
| Primary/secondary actions | `<Button>` | `import { Button } from '@/components/ui'` |
| Icon-only button | `<IconButton>` | `import { IconButton } from '@/components/ui'` |
| Button with dropdown menu | `<SplitButton>` | `import { SplitButton } from '@/components/ui'` |
| Centered dialog | `<Modal>` | `import { Modal } from '@/components/ui'` |
| Confirm before action | `<ConfirmDialog>` | `import { ConfirmDialog } from '@/components/ui'` |
| Hover tooltip | `<Tooltip>` | `import { Tooltip } from '@/components/ui'` |
| Positioned popup | `<Popover>` | `import { Popover } from '@/components/ui'` |
| Status indicator | `<Badge>` | `import { Badge } from '@/components/ui'` |
| Alert message | `<Alert>` | `import { Alert } from '@/components/ui'` |
| Loading spinner | `<Spinner>` | `import { Spinner } from '@/components/ui'` |
| Loading placeholder | `<Skeleton>` | `import { Skeleton } from '@/components/ui'` |
| Text input | `<Input>` | `import { Input } from '@/components/ui'` |
| Toggle switch | `<Switch>` | `import { Switch } from '@/components/ui'` |
| File upload area | `<FileDropZone>` | `import { FileDropZone } from '@/components/ui'` |

## Select vs Combobox

- **`<Select>`**: Use when the user picks from a short, known list (< 15 items). No search needed. Built on Radix UI Select.
- **`<Combobox>`**: Use when the list is long, dynamic, or needs search. Also use for multi-select. Built on Radix UI Popover with custom search.

## Adding New Tokens

1. Define the raw value in `src/styles/globals.css` `@theme` block
2. If it needs semantic mapping, add to `:root` and `[data-theme="dark"]` sections
3. If it needs JS access, add to `src/utils/statusColors.ts`
4. For chart/canvas use, call `resolveColor('var(--your-token)')` to get hex

## Never Do

- Hardcode hex colors in `.tsx` files
- Use `z-[arbitrary-number]` — use z-index tokens
- Use native `<select>` — use `<Select>` or `<Combobox>`
- Copy-paste pagination buttons — use `<Pagination>`
- Use Tailwind color classes like `text-red-500` — use `text-[var(--color-error)]`
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/README.md
git commit -m "docs: add UI component catalog README"
```

---

### Task 7: Phase 3 final verification

- [ ] **Step 1: Full build check**

Run: `npm run build && npm run lint && npx tsc -b`
Expected: Zero errors.

- [ ] **Step 2: Verify all docs are committed**

```bash
git status
git log --oneline -10
```

Expected: Clean working tree. All Phase 3 commits visible.

- [ ] **Step 3: Merge to main**

Branch is ready for merge. All three phases are complete:
- Phase 1: Token extension + new components
- Phase 2: Consumer migration + hardcoded value elimination
- Phase 3: Verification + documentation
