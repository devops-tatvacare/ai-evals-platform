# UI Design System Overhaul — Implementation Plan

> **Status:** Proposed
> **Date:** 2026-02-16
> **Scope:** Full design system audit, token consolidation, component hardening, ALL pages cleanup

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Audit](#2-current-state-audit)
3. [Phase 1: Token System Expansion](#3-phase-1-token-system-expansion)
4. [Phase 2: Remove All Hardcoded Colors](#4-phase-2-remove-all-hardcoded-colors)
5. [Phase 3: Eval Runs Pages — Full Theme Migration](#5-phase-3-eval-runs-pages--full-theme-migration)
6. [Phase 4: Component Library Hardening](#6-phase-4-component-library-hardening)
7. [Phase 5: Kaira Chat UX Redesign](#7-phase-5-kaira-chat-ux-redesign)
8. [Phase 6: All Other Pages Cleanup](#8-phase-6-all-other-pages-cleanup)
9. [Phase 7: Dark Mode Polish & Theme Transitions](#9-phase-7-dark-mode-polish--theme-transitions)
10. [Phase 8: Global Visual Polish](#10-phase-8-global-visual-polish)
11. [File-by-File Change Map](#11-file-by-file-change-map)
12. [Design Decisions & Rationale](#12-design-decisions--rationale)

---

## 1. Executive Summary

The platform has a solid foundation — CSS variables, Tailwind v4, `cn()` utility, light/dark toggle — but suffers from:

- **Eval Runs pages are COMPLETELY unthemed** — `bg-white`, `border-slate-200`, `text-slate-400` everywhere. Zero dark mode support. This is the #1 offender.
- **40+ hardcoded hex colors** scattered across label configs, eval components, and chat UI
- **10 hardcoded RGB color sets** in `MessageTagBadge`
- **Missing semantic states** — no proper info/warning/success/destructive banner components
- **Chat UX issues** — cramped messages, tiny avatars, no scroll-to-bottom, no typing indicator
- **Inconsistent icon usage** — some components miss icons, sizes vary
- **Dark mode gaps** — hardcoded colors don't respond to theme switches
- **No loading skeletons** — pages show "Loading..." text instead of skeleton placeholders
- **No consistent empty states** — every page rolls its own ad-hoc empty message
- **Font size chaos** — `text-[0.72rem]`, `text-[0.78rem]`, `text-[0.65rem]` scattered in eval pages

This plan systematises everything into a tight, token-driven design system that looks silky in both light and dark modes. **Every page** gets cleaned up.

---

## 2. Current State Audit

### What's Good (Keep)
- `globals.css` token architecture (`@theme` + `:root` + `[data-theme="dark"]`)
- `cn()` utility from `clsx` + `tailwind-merge`
- `ThemeProvider` with `data-theme` attribute + system preference detection
- `Button`, `Badge`, `Card`, `Modal`, `Tooltip` components using CSS variables
- Semantic color tokens: `--bg-primary`, `--text-primary`, `--interactive-primary`, etc.
- `lucide-react` as sole icon library

### What's Broken

#### CRITICAL — Eval Runs Pages (Zero Theming)

These pages completely bypass the CSS variable system. They use raw Tailwind color classes (`bg-white`, `border-slate-200`, `text-slate-800`) that are hardcoded to light mode:

| Page | Hardcoded Classes |
|------|-------------------|
| `evalRuns/pages/Dashboard.tsx` | `bg-white`, `border-slate-200`, `text-slate-400`, `text-slate-800`, `text-[0.65rem]`, `text-[0.72rem]` |
| `evalRuns/pages/RunDetail.tsx` | `bg-white`, `border-slate-200`, `text-slate-400`, `bg-blue-500`, `text-red-600`, `text-[0.78rem]`, `text-[0.74rem]` |
| `evalRuns/pages/RunList.tsx` | `text-slate-800`, `border-slate-200`, `bg-indigo-50`, `text-indigo-700` |
| `evalRuns/pages/Logs.tsx` | `bg-red-50`, `border-red-200`, `text-red-700`, `bg-violet-500`, `bg-blue-500`, `bg-emerald-50`, `border-emerald-200` |
| `evalRuns/pages/ThreadDetail.tsx` | `text-slate-400`, `border-indigo-200`, `bg-indigo-50` |
| `evalRuns/pages/AdversarialDetail.tsx` | `bg-white`, `border-slate-200`, `bg-slate-50/60`, `bg-red-50`, `border-red-100` |
| `evalRuns/components/RunCard.tsx` | `hover:border-indigo-200` |
| `evalRuns/components/EvalTable.tsx` | `border-slate-200`, `bg-slate-50/50` |
| `evalRuns/components/DistributionBar.tsx` | `bg-slate-100` |
| `evalRuns/components/TranscriptViewer.tsx` | `bg-slate-200/80`, `bg-blue-50`, `border-blue-100` |
| `evalRuns/components/MetricInfo.tsx` | `text-slate-400`, `hover:text-slate-600` |
| `evalRuns/components/RuleComplianceGrid.tsx` | Hardcoded emerald/red inline |
| `evalRuns/components/Tooltip.tsx` | `bg-slate-900`, `ARROW_COLOR="#0f172a"` |

#### HIGH — Hardcoded Colors in Config/Utils

| Problem | Location | Count |
|---------|----------|-------|
| Hardcoded hex colors | `labelDefinitions.ts` | 40+ |
| Hardcoded hex colors | `evalColors.ts` | 7 |
| Hardcoded RGB colors | `MessageTagBadge.tsx` | 30 (10 sets × 3) |

#### HIGH — Missing Components / Patterns

| Problem | Location |
|---------|----------|
| No `Alert`/`Banner` component | Ad-hoc error boxes in Dashboard, RunDetail, Logs, ThreadDetail, ChatView |
| No `EmptyState` component | Every page has inline ad-hoc empty messages |
| No `StatusDot` indicator | Eval run status uses inline colored borders |
| No `Skeleton` loading states | Dashboard, RunList, Logs show "Loading..." text |
| No `IconButton` component | Custom inline icon buttons everywhere |

#### MEDIUM — Chat UX

| Problem | Location |
|---------|----------|
| Chat avatars too small (28px) | `ChatMessage.tsx` |
| No scroll-to-bottom button | `ChatMessageList.tsx` |
| No typing indicator | `ChatMessage.tsx` (just spinner + "Thinking...") |
| No empty state with prompts | `ChatView.tsx` |
| Helper text always visible | `ChatInput.tsx` |
| Input/send button layout clunky | `ChatInput.tsx` |

#### LOW — Consistency Issues

| Problem | Location |
|---------|----------|
| Font sizes outside scale | `text-[0.65rem]`, `text-[0.72rem]`, `text-[0.78rem]` in eval pages |
| Inline `style={{}}` magic numbers | JSON viewers, progress bars, border colors (25+ instances) |
| Icon sizes inconsistent | `h-3 w-3` vs `h-4 w-4` vs `h-5 w-5` in similar contexts |
| No consistent focus rings | Some buttons have them, some don't |
| Spacing varies | `gap-3` vs `gap-4` vs `gap-2.5` without clear hierarchy |

---

## 3. Phase 1: Token System Expansion

### 3.1 New Semantic Color Tokens

Add to `globals.css` under `@theme`:

```css
@theme {
  /* --- Existing tokens (keep as-is) --- */

  /* NEW: Status palette (used by labels, badges, eval results) */
  --color-verdict-pass: #16a34a;
  --color-verdict-fail: #dc2626;
  --color-verdict-soft-fail: #ca8a04;
  --color-verdict-critical: #7c2d12;
  --color-verdict-na: #6b7280;

  /* NEW: Difficulty / priority */
  --color-level-easy: #3b82f6;
  --color-level-medium: #f59e0b;
  --color-level-hard: #ef4444;

  /* NEW: Category accent palette (eval categories, tag colors) */
  --color-accent-purple: #8b5cf6;
  --color-accent-cyan: #06b6d4;
  --color-accent-orange: #f97316;
  --color-accent-pink: #ec4899;
  --color-accent-teal: #14b8a6;
  --color-accent-indigo: #6366f1;
  --color-accent-lime: #84cc16;
  --color-accent-blue: #3b82f6;
  --color-accent-amber: #f59e0b;
  --color-accent-sky: #0ea5e9;
  --color-accent-fuchsia: #d946ef;
  --color-accent-rose: #f43f5e;
}
```

Add to `:root` (light mode) semantic layer:

```css
:root {
  /* --- Existing tokens (keep) --- */

  /* NEW: Surface tokens for status backgrounds */
  --surface-success: #f0fdf4;
  --surface-error: #fef2f2;
  --surface-warning: #fffbeb;
  --surface-info: #eef2ff;
  --surface-neutral: var(--bg-tertiary);

  /* NEW: Status border tokens */
  --border-success: #bbf7d0;
  --border-error: #fecaca;
  --border-warning: #fde68a;
  --border-info: #c7d2fe;

  /* NEW: Interactive ghost states */
  --interactive-ghost: transparent;
  --interactive-ghost-hover: var(--bg-tertiary);

  /* NEW: Code/prose */
  --bg-code: var(--bg-tertiary);
  --bg-code-block: var(--bg-tertiary);

  /* NEW: Chat-specific */
  --bg-chat-user: transparent;
  --bg-chat-assistant: var(--bg-secondary);
  --bg-chat-input: var(--bg-secondary);
  --border-chat-input: var(--border-default);
}
```

Add matching `[data-theme="dark"]` overrides:

```css
[data-theme="dark"] {
  /* --- Existing dark overrides (keep) --- */

  /* NEW: Surface tokens - dark variants */
  --surface-success: rgba(16, 185, 129, 0.1);
  --surface-error: rgba(239, 68, 68, 0.1);
  --surface-warning: rgba(245, 158, 11, 0.1);
  --surface-info: rgba(99, 102, 241, 0.1);
  --surface-neutral: var(--bg-tertiary);

  --border-success: rgba(16, 185, 129, 0.3);
  --border-error: rgba(239, 68, 68, 0.3);
  --border-warning: rgba(245, 158, 11, 0.3);
  --border-info: rgba(99, 102, 241, 0.3);

  --bg-code: var(--color-neutral-800);
  --bg-code-block: var(--color-neutral-800);

  --bg-chat-user: transparent;
  --bg-chat-assistant: var(--color-neutral-800);
  --bg-chat-input: var(--color-neutral-800);
  --border-chat-input: var(--color-neutral-600);
}
```

### 3.2 New Spacing / Layout Tokens

Add to `@theme`:

```css
@theme {
  /* NEW: Chat-specific dimensions */
  --chat-avatar-size: 32px;
  --chat-avatar-icon: 16px;
  --chat-input-min-h: 44px;
  --chat-input-max-h: 200px;
  --chat-message-gap: 16px;
  --chat-bubble-padding-x: 16px;
  --chat-bubble-padding-y: 12px;

  /* NEW: Component tokens */
  --sidebar-width: 280px;
  --sidebar-collapsed-width: 56px;
  --header-height: 48px;
}
```

---

## 4. Phase 2: Remove All Hardcoded Colors

### 4.1 `src/config/labelDefinitions.ts` — The Big One

**Strategy:** Replace every hardcoded hex with a reference to CSS variable via a helper function.

Create a new utility `src/utils/statusColors.ts`:

```typescript
/**
 * Centralized status/verdict color map.
 * References CSS custom properties so colors respond to light/dark theme.
 * For use in JS contexts (inline styles, chart configs) where CSS vars are needed.
 */

// For inline style usage: returns CSS variable reference string
export const STATUS_COLORS = {
  // Verdicts
  pass: 'var(--color-verdict-pass)',
  softFail: 'var(--color-verdict-soft-fail)',
  hardFail: 'var(--color-verdict-fail)',
  critical: 'var(--color-verdict-critical)',
  na: 'var(--color-verdict-na)',

  // Difficulty
  easy: 'var(--color-level-easy)',
  medium: 'var(--color-level-medium)',
  hard: 'var(--color-level-hard)',

  // Job status
  running: 'var(--color-info)',
  completed: 'var(--color-success)',
  failed: 'var(--color-error)',
  interrupted: 'var(--color-warning)',

  // Recovery
  good: 'var(--color-success)',
  partial: 'var(--color-warning)',
  failedRecovery: 'var(--color-error)',
  notNeeded: 'var(--color-verdict-na)',

  // Friction cause
  user: 'var(--color-info)',
  bot: 'var(--color-error)',

  // Fallback
  default: 'var(--color-verdict-na)',
} as const;

// Category accent colors (eval categories, chart series)
export const CATEGORY_ACCENT_COLORS = {
  quantity_ambiguity: 'var(--color-accent-purple)',
  multi_meal_single_message: 'var(--color-accent-cyan)',
  correction_contradiction: 'var(--color-accent-orange)',
  edit_after_confirmation: 'var(--color-accent-pink)',
  future_time_rejection: 'var(--color-accent-teal)',
  contextual_without_context: 'var(--color-accent-indigo)',
  composite_dish: 'var(--color-accent-lime)',
} as const;

// For Recharts/canvas which need resolved hex values, not CSS vars.
// Use getComputedStyle(document.documentElement).getPropertyValue('--color-verdict-pass')
export function resolveColor(cssVar: string): string {
  if (typeof window === 'undefined') return cssVar;
  const varName = cssVar.replace(/^var\(/, '').replace(/\)$/, '');
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || cssVar;
}
```

**Then refactor `labelDefinitions.ts`** to import from `statusColors.ts` instead of using inline hex values. Each label definition's `color` field changes from `'#16a34a'` to `STATUS_COLORS.pass`, etc.

### 4.2 `src/utils/evalColors.ts`

Replace the `CATEGORY_COLORS` object to import from `statusColors.ts`:

```typescript
import { CATEGORY_ACCENT_COLORS } from './statusColors';
export const CATEGORY_COLORS = CATEGORY_ACCENT_COLORS;
```

### 4.3 `src/features/kaira/components/MessageTagBadge.tsx`

Replace the `TAG_COLORS` array with CSS-variable-backed definitions:

```typescript
const TAG_COLORS = [
  { bg: 'var(--color-accent-blue)',   border: 'var(--color-accent-blue)',   text: 'var(--color-accent-blue)' },
  { bg: 'var(--color-accent-purple)', border: 'var(--color-accent-purple)', text: 'var(--color-accent-purple)' },
  { bg: 'var(--color-accent-pink)',   border: 'var(--color-accent-pink)',   text: 'var(--color-accent-pink)' },
  // ... etc using --color-accent-* tokens
];
```

Apply alpha via Tailwind's opacity modifier or `color-mix()`:
```typescript
// Background at 10% opacity, border at 20% opacity
style={{
  backgroundColor: `color-mix(in srgb, ${color.bg} 10%, transparent)`,
  borderColor: `color-mix(in srgb, ${color.border} 20%, transparent)`,
  color: color.text,
}}
```

### 4.4 Eval Run Components

| File | Change |
|------|--------|
| `TrendChart.tsx` | `stroke="#f1f5f9"` → `stroke="var(--border-subtle)"` |
| `Tooltip.tsx` (evalRuns) | `ARROW_COLOR = "#0f172a"` → `"var(--bg-elevated)"` |
| `EvalTable.tsx` | Replace `"#16a34a"` / `"#dc2626"` with `STATUS_COLORS.pass` / `STATUS_COLORS.hardFail` |
| `RunDetail.tsx` | Replace `CATEGORY_COLORS[...] ?? "#6b7280"` with `CATEGORY_ACCENT_COLORS[...] ?? STATUS_COLORS.default` |
| `ThreadDetail.tsx` | `accentColor="#ef4444"` → `STATUS_COLORS.hardFail` |
| `AdversarialDetail.tsx` | Same pattern as RunDetail |
| `DistributionBar.tsx` | Uses `getVerdictColor()` — update that function in `labelDefinitions.ts` |

### 4.5 Recharts / Canvas Compatibility

Recharts needs resolved hex values, not CSS variable strings. For chart-specific usage, use the `resolveColor()` helper:

```typescript
// In TrendChart.tsx
import { resolveColor, STATUS_COLORS } from '@/utils/statusColors';

<CartesianGrid stroke={resolveColor('var(--border-subtle)')} />
```

Or use a `useResolvedColors()` hook that re-resolves on theme change:

```typescript
function useResolvedColor(cssVar: string): string {
  const [color, setColor] = useState(() => resolveColor(cssVar));
  useEffect(() => {
    const observer = new MutationObserver(() => setColor(resolveColor(cssVar)));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [cssVar]);
  return color;
}
```

---

## 5. Phase 3: Eval Runs Pages — Full Theme Migration

This is the **highest-impact phase**. The entire `src/features/evalRuns/` directory was ported from a separate project and never migrated to the CSS variable system. Every page uses raw Tailwind color classes hardcoded for light mode.

### 5.1 Migration Strategy

**Global find-and-replace map** — apply across ALL files in `src/features/evalRuns/`:

| Hardcoded Class | Replace With |
|-----------------|--------------|
| `bg-white` | `bg-[var(--bg-primary)]` |
| `bg-slate-50` / `bg-slate-50/50` / `bg-slate-50/60` | `bg-[var(--bg-secondary)]` |
| `bg-slate-100` | `bg-[var(--bg-tertiary)]` |
| `border-slate-200` | `border-[var(--border-subtle)]` |
| `border-slate-300` | `border-[var(--border-default)]` |
| `text-slate-400` | `text-[var(--text-muted)]` |
| `text-slate-500` | `text-[var(--text-secondary)]` |
| `text-slate-600` | `text-[var(--text-secondary)]` |
| `text-slate-700` | `text-[var(--text-primary)]` |
| `text-slate-800` | `text-[var(--text-primary)]` |
| `text-slate-900` | `text-[var(--text-primary)]` |
| `bg-indigo-50` | `bg-[var(--surface-info)]` |
| `text-indigo-700` / `text-indigo-600` | `text-[var(--color-info)]` |
| `border-indigo-200` | `border-[var(--border-info)]` |
| `bg-red-50` | `bg-[var(--surface-error)]` |
| `text-red-700` / `text-red-600` | `text-[var(--color-error)]` |
| `border-red-200` / `border-red-100` | `border-[var(--border-error)]` |
| `bg-emerald-50` / `bg-green-50` | `bg-[var(--surface-success)]` |
| `text-emerald-700` / `text-green-700` | `text-[var(--color-success)]` |
| `border-emerald-200` | `border-[var(--border-success)]` |
| `bg-blue-500` | `bg-[var(--interactive-primary)]` |
| `text-blue-600` | `text-[var(--text-brand)]` |
| `bg-violet-500` | `bg-[var(--color-accent-purple)]` |
| `hover:border-indigo-200` | `hover:border-[var(--border-focus)]` |
| `bg-slate-900 text-white` (tooltip) | `bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-default)] shadow-lg` |

### 5.2 Page-by-Page Fixes

#### `Dashboard.tsx`

**Current:** Inline `StatCard` component using `bg-white border border-slate-200`.

**Fix:**
- Replace with `Card` component from `src/components/ui/Card.tsx`
- Or convert: `bg-white` → `bg-[var(--bg-primary)]`, `border-slate-200` → `border-[var(--border-subtle)]`
- Replace `text-slate-400` → `text-[var(--text-muted)]`
- Replace `text-slate-800` → `text-[var(--text-primary)]`
- Fix font sizes: `text-[0.65rem]` → `text-[var(--text-xs)]` (11px), `text-[0.72rem]` → `text-[var(--text-sm)]` (13px)
- Error state: Replace `bg-red-50 border border-red-200` box with `<Alert variant="error">`
- Loading state: Replace "Loading..." text with `<Skeleton />` cards
- Empty state: Replace inline "No runs yet" with `<EmptyState icon={BarChart3} title="No evaluation runs yet" />`

#### `RunList.tsx`

**Fix:**
- Replace all `text-slate-*` with CSS var equivalents
- Filter pills: `bg-indigo-50 text-indigo-700` (active) → `bg-[var(--surface-info)] text-[var(--color-info)]`
- Filter pills: `bg-white border-slate-200` (inactive) → `bg-[var(--bg-primary)] border-[var(--border-subtle)]`
- Loading state: Add skeleton `RunCard` placeholders
- Empty state: Use `<EmptyState />`

#### `RunDetail.tsx`

**Fix (extensive — largest eval page):**
- All `bg-white` → `bg-[var(--bg-primary)]`
- All `border-slate-200` → `border-[var(--border-subtle)]`
- Breadcrumb: Fix `text-[0.78rem]` → `text-[var(--text-sm)]`
- View toggle buttons: `bg-blue-500 text-white` → use `<Tabs />` component or `Button` variant
- Verdict filter pills: Same as RunList
- Search input: Use `<Input />` component from UI library
- Table: Migrate `EvalTable` internals (next section)
- Distribution bars: Migrate `DistributionBar` (next section)
- Inline style `borderLeftColor` with hex → CSS var from `STATUS_COLORS`
- Error state: Use `<Alert variant="error">`
- Font sizes: `text-[0.74rem]` → `text-[var(--text-sm)]`

#### `ThreadDetail.tsx`

**Fix:**
- All slate colors → CSS vars
- Verdict badges: Ensure `VerdictBadge` uses CSS vars internally
- Tab buttons: Replace with `<Tabs />` component
- Accent colors: `border-indigo-200` → `border-[var(--border-info)]`
- Error state: Use `<Alert />`

#### `AdversarialDetail.tsx`

**Fix:**
- All `bg-white` / `border-slate-*` → CSS vars
- Failure mode badges: `bg-red-50 border-red-100` → `bg-[var(--surface-error)] border-[var(--border-error)]`
- Inline `borderLeftColor` → CSS var

#### `Logs.tsx`

**Fix:**
- Error state: `bg-red-50 border-red-200 text-red-700` → `<Alert variant="error">`
- Method badges: `bg-violet-500`, `bg-blue-500` → CSS var accent colors
- Expand/collapse: Replace Unicode arrows `↑↓` with lucide `ChevronDown`/`ChevronUp` icons
- Expanded row grid: All slate colors → CSS vars
- Pass/fail indicators: `bg-emerald-50 border-emerald-200` → `bg-[var(--surface-success)] border-[var(--border-success)]`
- Loading skeleton for log table rows

### 5.3 Component-by-Component Fixes

#### `RunCard.tsx`
- `hover:border-indigo-200` → `hover:border-[var(--border-focus)]`
- Use `Card` component as base wrapper
- Ensure `VerdictBadge` uses themed colors

#### `EvalTable.tsx`
- `border-slate-200` → `border-[var(--border-subtle)]`
- `bg-slate-50/50` (expanded row) → `bg-[var(--bg-secondary)]`
- Hex colors in `borderLeft` styles → `STATUS_COLORS.*`
- Sort icons: Ensure consistent sizing

#### `DistributionBar.tsx`
- `bg-slate-100` base → `bg-[var(--bg-tertiary)]`
- Segment colors: Ensure `getVerdictColor()` returns CSS vars

#### `TranscriptViewer.tsx`
- User bubble: `bg-slate-200/80` → `bg-[var(--bg-tertiary)]`
- Bot bubble: `bg-blue-50 border-blue-100` → `bg-[var(--surface-info)] border-[var(--border-info)]`
- Image badge: Hardcoded colors → CSS vars

#### `Tooltip.tsx` (evalRuns)
- `bg-slate-900 text-white` → `bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-default)] shadow-lg`
- `ARROW_COLOR="#0f172a"` → `var(--bg-elevated)`

#### `MetricInfo.tsx`
- `text-slate-400` → `text-[var(--text-muted)]`
- `hover:text-slate-600` → `hover:text-[var(--text-primary)]`

#### `RuleComplianceGrid.tsx`
- Hardcoded emerald/red → CSS var status colors
- `bg-emerald-50` → `bg-[var(--surface-success)]`

#### `VerdictBadge.tsx`
- Review: Does it already use `getVerdictColor()` → make sure that returns CSS vars
- `text-white` → `text-[var(--text-on-color)]` (if on colored bg)

#### `TrendChart.tsx`
- Grid: `stroke="#f1f5f9"` → `resolveColor('var(--border-subtle)')`
- Axis ticks: Theme-aware text color
- Tooltip: Theme-aware background
- Line colors: Use `resolveColor()` hook for theme reactivity

### 5.4 TraceMessageRow & TraceStatisticsBar (Kaira Trace Views)

These components under `src/features/kaira/components/` also have issues:

#### `TraceMessageRow.tsx`
- Hardcoded grid template `grid-cols-[auto_60px_100px_1fr_120px_80px]` — keep but ensure colors are themed
- `text-[10px]` for timestamps → minimum `text-[var(--text-xs)]` (11px) for accessibility
- Margin calculation `ml-[calc(60px+100px+1.5rem)]` — keep as layout necessity
- Ensure all role badge colors (User/Bot) use themed variants

#### `TraceStatisticsBar.tsx`
- Icon sizes: Standardize to `h-3.5 w-3.5` (currently `h-3 w-3`)
- Ensure text colors use `--text-*` vars

---

## 6. Phase 4: Component Library Hardening

### 6.1 New Component: `Alert` / `Banner`

Create `src/components/ui/Alert.tsx`:

```typescript
interface AlertProps {
  variant: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
  icon?: LucideIcon;  // Optional override
  className?: string;
}
```

**Visual spec:**
- Left border accent (3px) in status color
- Surface background from `--surface-{variant}`
- Icon from lucide: `Info` / `CheckCircle2` / `AlertTriangle` / `XCircle`
- Status-colored icon, `--text-primary` for body text
- Optional dismiss `X` button top-right
- `rounded-md` corners, `px-4 py-3` padding

**Usage:** Replace all ad-hoc error banners in `ChatView.tsx`, eval pages, etc.

### 6.2 New Component: `StatusDot`

Create `src/components/ui/StatusDot.tsx`:

```typescript
interface StatusDotProps {
  status: 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'running';
  size?: 'sm' | 'md';
  pulse?: boolean;  // Animated pulse for "running"
  label?: string;
}
```

**Visual spec:**
- 8px (`sm`) or 10px (`md`) circle
- Filled with status color
- Optional `animate-pulse` for running state
- Optional text label beside dot

**Usage:** Replace inline colored borders on eval sections, job status indicators.

### 6.3 New Component: `EmptyState`

Create `src/components/ui/EmptyState.tsx`:

```typescript
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void; isLoading?: boolean };
}
```

**Visual spec:**
- Centered layout, `gap-4`
- 64px icon circle with `--surface-info` background + `--text-brand` icon
- Title in `--text-primary`, description in `--text-secondary`
- Optional primary action button

**Usage:** Chat empty state, eval empty states, listing zero states.

### 6.4 New Component: `ScrollToBottom`

Create `src/components/ui/ScrollToBottom.tsx`:

```typescript
interface ScrollToBottomProps {
  visible: boolean;
  onClick: () => void;
  unreadCount?: number;
}
```

**Visual spec:**
- Floating circle button, `40px`, positioned `bottom-4 right-4` (absolute within scroll container)
- `ArrowDown` icon from lucide
- `--bg-elevated` background, `--shadow-md` shadow
- Optional badge showing unread message count
- Fade in/out with `transition-opacity`

### 6.5 Enhance Existing `Badge`

Current Badge has good variants. Add:
- **`size` prop**: `'sm' | 'md'` (current = `sm`, add `md` for eval labels)
- **`dot` prop**: Optional `StatusDot` before text
- **`icon` prop**: Optional lucide icon before text

### 6.6 Enhance Existing `Button`

Add:
- **`icon` prop**: Lucide icon rendered at correct size for the button size
- **`iconOnly` prop**: For square icon-only buttons (used in chat send, sidebar actions)
- Ensure all icon sizes follow the pattern: `sm` → `h-3.5 w-3.5`, `md` → `h-4 w-4`, `lg` → `h-4.5 w-4.5`

### 6.7 New Component: `IconButton`

Alternatively, create a dedicated `IconButton` for icon-only buttons:

```typescript
interface IconButtonProps {
  icon: LucideIcon;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'secondary' | 'primary' | 'danger';
  label: string;  // Required aria-label
  onClick?: () => void;
}
```

**Visual spec:**
- Square aspect ratio: `sm` → 28px, `md` → 32px, `lg` → 40px
- Centered icon
- `rounded-md` default, `rounded-full` for floating buttons
- `title` attribute from `label`

### 6.8 New Component: `Skeleton` Loading States

Create `src/components/ui/Skeleton.tsx` (enhance existing):

The codebase already has a basic `Skeleton.tsx`. Enhance it with:

```typescript
// Card skeleton (for Dashboard stat cards, RunCards)
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-[var(--radius-default)] border border-[var(--border-subtle)] p-4 space-y-3', className)}>
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-2 w-full" />
    </div>
  );
}

// Table row skeleton
export function SkeletonTableRow({ cols = 4 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-2.5">
          <Skeleton className="h-3 w-full" />
        </td>
      ))}
    </tr>
  );
}

// Chat message skeleton
export function SkeletonMessage() {
  return (
    <div className="flex gap-3 px-5 py-4">
      <Skeleton className="h-8 w-8 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}
```

**Usage:** Replace every "Loading..." text with appropriate skeleton variant.

### 6.9 Ensure Icon Consistency

**Standard icon sizes by context:**

| Context | Icon Size | Class |
|---------|-----------|-------|
| Button `sm` | 14px | `h-3.5 w-3.5` |
| Button `md` | 16px | `h-4 w-4` |
| Button `lg` | 18px | `h-4.5 w-4.5` |
| Inline text | 14px | `h-3.5 w-3.5` |
| Badge | 12px | `h-3 w-3` |
| Empty state circle | 24px | `h-6 w-6` |
| Page title icon | 20px | `h-5 w-5` |
| Sidebar nav | 18px | `h-4.5 w-4.5` |

**Audit all lucide-react imports** — ensure every icon follows these size conventions. Current code has inconsistent icon sizes (some `h-3 w-3`, some `h-4 w-4`, some `h-5 w-5` in similar contexts).

---

## 7. Phase 5: Kaira Chat UX Redesign

This is the biggest visual transformation. The goal: a modern, clean chat that feels like a premium product.

### 7.1 Message Layout Overhaul

**Before:**
```
┌─────────────────────────────────────────┐
│ [28px avatar] [gap-2.5] Content         │
│ px-4 py-3, divide-y between messages    │
└─────────────────────────────────────────┘
```

**After:**
```
┌─────────────────────────────────────────────┐
│                                             │
│  [32px avatar]  [gap-3] Content area        │
│                 Kaira · 2.3s                │
│                 Markdown body...            │
│                 [action buttons]            │
│                                             │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │ (subtle divider, not full border)
│                                             │
│  [32px avatar]  You                         │
│                 User message text           │
│                                             │
└─────────────────────────────────────────────┘
```

**Specific changes to `ChatMessage.tsx`:**

1. **Avatar**: `h-7 w-7` → `h-8 w-8` (32px). Icon inside: `h-4 w-4` (16px). More room to breathe.
2. **Message padding**: `px-4 py-3` → `px-5 py-4`. More horizontal breathing room.
3. **Content gap**: `gap-2.5` → `gap-3`.
4. **Role label**: Add relative timestamp next to "Kaira" or "You" — e.g., "Kaira · 2.3s ago"
5. **Bot message bg**: Keep `--bg-chat-assistant` but add `rounded-lg` instead of full-width band. Apply slight `--shadow-sm` on bot messages.
6. **User message**: Keep transparent bg but add a subtle `border-l-2 border-[var(--color-brand-accent)]` on the left for visual anchor.
7. **Dividers**: Remove `divide-y` line. Use `gap-1` between messages (spacing only, no borders). Group messages from same sender without avatar repeat.

### 7.2 Typing Indicator

Replace the current spinner + "Thinking..." with an animated dots indicator:

**New component: `TypingIndicator.tsx`**
```
┌──────────────────────────────┐
│  [avatar]  ● ● ●            │
│            (bouncing dots)   │
└──────────────────────────────┘
```

**CSS animation:**
```css
@keyframes typing-dot {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-4px); }
}
```

Three dots, each delayed by 150ms. Uses `--text-muted` color.

### 7.3 Chat Input Redesign

**Before:** Bordered textarea + separate square send button + always-visible helper text.

**After:**
```
┌─────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────┐ │
│ │ Ask Kaira anything...          [Send ▶] │ │
│ │                                         │ │
│ └─────────────────────────────────────────┘ │
│         Enter to send · Shift+Enter newline │
└─────────────────────────────────────────────┘
```

**Changes to `ChatInput.tsx`:**

1. **Container**: Wrap textarea and button in a single bordered container (unified input field look). Remove separate border-top on the container.
2. **Send button**: Move inside the textarea container, aligned bottom-right. Make it a small circle (36px) or rounded pill button, not a separate 48px square.
3. **Helper text**: Show on focus only. Fade in/out with `opacity` transition. Smaller: `text-[10px]`.
4. **Textarea**: Remove its own border. The wrapping container provides the border. Background: `--bg-primary` (matches page), container border: `--border-default`.
5. **Focus state**: Container border changes to `--border-focus` + ring.
6. **Min height**: 44px (one line). Max height: 160px (reduce from 200px for cleaner look).
7. **Padding**: `px-4 py-3` inside textarea, `p-3` on outer container.
8. **Cancel button** (streaming): Replace with a subtle "Stop" text link or a small stop icon inside the input, not a giant separate button.

### 7.4 Scroll-to-Bottom Button

Add `ScrollToBottom` component to `ChatMessageList.tsx`:
- Track scroll position with `IntersectionObserver` on bottom anchor
- When user scrolls up past a threshold, show the floating button
- Click scrolls to bottom smoothly
- Badge shows count of new messages received while scrolled up

### 7.5 Empty State

Replace the current empty state in `ChatView.tsx` with the `EmptyState` component:
- Kaira bot icon (or `MessageSquare`)
- "Start a conversation" heading
- "Ask Kaira about health, nutrition, or anything" subheading
- Suggested prompt chips (3-4 example questions the user can click to start)

**New: Suggested Prompts**
```typescript
const SUGGESTED_PROMPTS = [
  'What are good sources of protein?',
  'Help me plan a balanced meal',
  'What should I eat for recovery after exercise?',
];
```

Render as clickable chips/cards below the empty state. On click, auto-send as first message.

### 7.6 Message Grouping

When consecutive messages are from the same role, collapse the avatar:

```
┌────────────────────────────────────────┐
│  [avatar]  Kaira                       │
│            First message...            │
│                                        │
│            Second message...           │  ← No avatar, just indent
│                                        │
│            Third message...            │  ← No avatar, just indent
└────────────────────────────────────────┘
```

Check if `messages[i].role === messages[i-1]?.role`. If same, hide avatar and role label, reduce top padding.

### 7.7 Markdown Styling Polish

In `ChatMessage.tsx` markdown components:

1. **Code blocks**: Add `--bg-code-block` background, subtle `border-[var(--border-subtle)]`, `font-mono`, copy button top-right
2. **Inline code**: `--bg-code` background, `rounded-sm`, `px-1.5 py-0.5`
3. **Tables**: Alternating row colors using `--bg-secondary` on even rows
4. **Blockquotes**: Left border `--color-brand-accent` instead of `--border-default`
5. **Links**: `--text-brand` with underline on hover (already correct)
6. **Headings**: Increase spacing above headings. `mt-4 mb-2` for h2, `mt-3 mb-1.5` for h3.

---

## 8. Phase 6: All Other Pages Cleanup

Every page in the app needs to conform to the design system. Here's the page-by-page fix list for pages NOT covered in Phase 3 (eval runs) or Phase 5 (chat).

### 8.1 `src/app/pages/HomePage.tsx`

**Current issues:**
- Progress bar uses inline `style={{ width: ${progress}% }}` — this is fine (dynamic value), keep it
- Uses `bg-[var(--color-brand-primary)]` correctly

**Fixes:**
- Verify all text uses `--text-*` vars
- Loading state: Add skeleton card placeholders if there's loading

### 8.2 `src/app/pages/ListingPage.tsx`

**Current issues:**
- `height: 'calc(100vh - 48px)'` hardcoded inline style
- `max-w-xl` constraint on listing content
- Error text uses `text-[var(--color-error)]` correctly

**Fixes:**
- Replace `calc(100vh - 48px)` with `h-[calc(100vh-var(--header-height))]` using the new token
- Verify all states (loading, empty, error) use consistent patterns
- Use `<Alert>` for error states
- Use `<EmptyState>` for zero listings

### 8.3 `src/features/evals/components/EvaluatorsView.tsx`

**Current issues:**
- Uses `p-6` padding — fine but verify consistency
- Empty state is inline JSX with `Plus` icon — should use `<EmptyState>`
- No loading skeleton while evaluators fetch

**Fixes:**
- Loading: Replace with `<SkeletonCard />` grid
- Empty: Use `<EmptyState icon={BarChart3} title="No evaluators yet" description="Create your first evaluator to start" />`
- Verify all card components use `Card` from UI library

### 8.4 `src/features/evals/components/` — All Sub-components

**EvaluatorCard.tsx:**
- Verify uses `Card` component or CSS vars for bg/border
- Metric displays should use consistent font scale

**MetricCard.tsx / MetricsBar.tsx:**
- Progress bars using inline `style={{ width }}` — fine (dynamic)
- Verify bar colors use CSS vars

**EvaluationProgress.tsx:**
- Progress bar width is dynamic — fine
- Verify status text colors use `--color-success`/`--color-error`

**ScoreDisplay.tsx:**
- Progress bars — fine
- Verify score colors use CSS vars

**HumanEvalNotepad.tsx:**
- `max-h-[calc(100vh-280px)]` — keep as layout necessity
- Verify all text/border/bg colors use CSS vars

**SegmentComparisonTable.tsx:**
- `ml-[calc(24px+80px+1.5rem)]` — keep as layout necessity
- `max-h-[calc(100vh-320px)]` — keep
- Verify table borders and backgrounds use CSS vars

**EvaluatorHistoryListOverlay.tsx:**
- Uses CSS vars well in most places
- Filter buttons: `text-blue-600 dark:text-blue-400` → `text-[var(--text-brand)]`
- Pagination: Should use consistent button styling

**EvaluatorHistoryDetailsOverlay.tsx:**
- Uses CSS vars well
- Error state lines 153-154: Hardcoded red → use `--color-error`

### 8.5 `src/features/settings/components/SettingsPage.tsx`

**Current issues:**
- Fixed bottom buttons: `fixed bottom-6 right-6` — may overlap content, needs z-index
- `pb-20` to accommodate fixed buttons — fragile pattern

**Fixes:**
- Add `z-10` to fixed buttons
- Verify all form inputs use `Input` component from UI library
- Verify all text colors use CSS vars
- Consider sticky footer instead of fixed positioning

### 8.6 `src/features/kairaBotSettings/components/`

**KairaBotSettingsPage.tsx:**
- Uses `ℹ️` emoji — replace with `<Info />` lucide icon
- Verify all styling uses CSS vars

**TagManagementPage.tsx:**
- `max-w-4xl mx-auto` — fine, consistent pattern
- Icons correctly used but sizes vary (`h-3.5 w-3.5` vs `h-12 w-12`)
- Standardize icon sizes per context scale
- Empty state for zero tags: Use `<EmptyState>`

### 8.7 `src/features/transcript/components/`

**TranscriptView.tsx:**
- Uses CSS vars properly in most places
- `whitespace-pre-wrap leading-relaxed` — add `break-words` for safety
- Verify skeleton loading state exists

**AudioPlayer.tsx:**
- `minHeight: '64px'` inline — fine (component layout necessity)
- WaveSurfer config: `cursorWidth: 2, barWidth: 2` — fine (canvas config)
- Verify all control button colors use CSS vars

**TranscriptZeroState.tsx:**
- Should use `<EmptyState>` component

### 8.8 `src/features/structured-outputs/components/`

**StructuredOutputsView.tsx:**
- Verify all styling uses CSS vars
- `max-h-[calc(100vh-400px)]` — keep

**JsonViewer.tsx / EnhancedJsonViewer.tsx:**
- `paddingLeft: depth * 16` inline — keep (dynamic indentation)
- `dark:bg-yellow-700` in EnhancedJsonViewer line 29 → use `bg-[var(--color-warning)]` or `bg-[var(--surface-warning)]`
- Verify all value type colors use CSS vars

**OutputCard.tsx / ReferenceCard.tsx:**
- Verify uses `Card` component or CSS vars

### 8.9 `src/features/upload/components/UploadZone.tsx`

- Good use of CSS vars mostly
- `bg-[var(--color-error)]/10` vs `bg-[var(--color-brand-accent)]/20` — verify opacity syntax works in Tailwind v4
- Consider using `--surface-error` instead of manual opacity

### 8.10 `src/features/export/components/ExportDropdown.tsx`

- Verify dropdown uses CSS vars for bg/border/text
- Verify all button states themed

### 8.11 `src/components/layout/Sidebar.tsx`

**Fixes:**
- Verify search input uses `Input` component
- Status badges (Done, Processing, Draft): Use `Badge` component with appropriate variants
- Delete confirmation: Uses `ConfirmDialog` — verify it's themed
- Collapsed icons: Verify icon sizes follow scale

### 8.12 `src/components/layout/MainLayout.tsx`

**Fixes:**
- Verify offline banner uses CSS vars
- Keyboard shortcut modal: Verify themed
- Padding `p-6` on main content — verify consistency

---

## 9. Phase 7: Dark Mode Polish & Theme Transitions

### 9.1 Audit All Components for Dark Mode

Every component using `var(--*)` tokens already works. The issue is components with:
- Hardcoded hex → doesn't change in dark mode
- `prose dark:prose-invert` → needs specific overrides for custom markdown components
- Chart colors → need `resolveColor()` hook

### 9.2 Dark Mode Specific Fixes

| Component | Issue | Fix |
|-----------|-------|-----|
| `ChatMessage.tsx` | Uses `prose dark:prose-invert` but custom components override prose styles | Remove `dark:prose-invert`, fully control colors via CSS vars |
| `TrendChart.tsx` | Grid stroke `#f1f5f9` is invisible in dark mode | Use `resolveColor('var(--border-subtle)')` |
| `evalRuns/Tooltip.tsx` | Arrow color `#0f172a` is invisible against dark bg | Use `var(--bg-elevated)` |
| `labelDefinitions.ts` | All 40+ hex colors don't change in dark mode | Migrate to CSS vars (Phase 2) |
| `MessageTagBadge.tsx` | RGB values don't change | Migrate to CSS vars (Phase 2) |
| `NoticeBox.tsx` | Already uses themed colors | Verify contrast ratios |
| `DistributionBar.tsx` | Uses `getVerdictColor()` | Ensure it returns CSS vars |

### 9.3 Dark Mode Contrast Verification

After migration, verify these contrast ratios meet WCAG AA (4.5:1 for text):
- `--text-primary` on `--bg-primary` (light: 6.5:1 ✓, dark: need to verify)
- `--text-secondary` on `--bg-primary` (may need lighter shade in dark mode)
- Status colors on `--surface-*` backgrounds
- `--text-brand` on `--bg-primary` both modes

### 9.4 Smooth Theme Transition

Add to `globals.css`:

```css
/* Smooth theme transition */
html[data-theme-transitioning] * {
  transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease, box-shadow 200ms ease !important;
}
```

In `ThemeProvider.tsx`, add `data-theme-transitioning` attribute briefly during theme switch, then remove after 300ms. This makes the light↔dark toggle feel silky rather than jarring.

---

## 10. Phase 8: Global Visual Polish

### 10.1 Typography Consistency

Enforce these rules project-wide:

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Page title | `text-lg` (16px) | `font-semibold` | `--text-primary` |
| Section title | `text-base` (14px) | `font-semibold` | `--text-primary` |
| Body text | `text-sm` (13px) | `font-normal` | `--text-primary` |
| Secondary text | `text-sm` (13px) | `font-normal` | `--text-secondary` |
| Label/caption | `text-xs` (11px) | `font-medium` | `--text-muted` |
| Code | `text-sm` (13px) | `font-normal` | `--text-primary` + `font-mono` |
| Badge text | `text-xs` (11px) | `font-medium` | Per variant |

### 10.2 Spacing Consistency

Use the spacing scale everywhere. Kill magic numbers:

| Usage | Token | Value |
|-------|-------|-------|
| Tight inner padding | `p-2` | 8px |
| Standard inner padding | `p-3` | 12px |
| Comfortable inner padding | `p-4` | 16px |
| Section gap | `gap-4` | 16px |
| Related items gap | `gap-2` | 8px |
| Tight items gap | `gap-1.5` | 6px |

### 10.3 Border & Shadow Consistency

- Cards: `border border-[var(--border-subtle)]` + `rounded-[var(--radius-default)]` + `shadow-sm`
- Elevated cards (popovers, dropdowns): `border-[var(--border-default)]` + `shadow-md`
- Modals: `shadow-lg` + `border-[var(--border-subtle)]`
- Inputs: `border-[var(--border-default)]` → `border-[var(--border-focus)]` on focus

### 10.4 Transition Consistency

Standard transition classes:
- Colors: `transition-colors duration-150`
- All properties: `transition-all duration-200`
- Transform: `transition-transform duration-150`

Apply to all interactive elements (buttons, links, badges, cards with hover).

### 10.5 Focus States

Every interactive element must have:
```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] focus-visible:ring-offset-1
```

Audit all `<button>`, `<a>`, `<input>`, `<textarea>` elements.

---

## 11. File-by-File Change Map

### New Files to Create

| File | Purpose | Phase |
|------|---------|-------|
| `src/utils/statusColors.ts` | Centralized color constants + `resolveColor()` helper | 2 |
| `src/hooks/useResolvedColor.ts` | Hook for theme-reactive color resolution (charts) | 2 |
| `src/components/ui/Alert.tsx` | Info/success/warning/error banner component | 4 |
| `src/components/ui/StatusDot.tsx` | Status indicator dot with pulse animation | 4 |
| `src/components/ui/EmptyState.tsx` | Reusable empty/zero state with icon + action | 4 |
| `src/components/ui/ScrollToBottom.tsx` | Floating scroll-to-bottom button for chat | 4 |
| `src/components/ui/IconButton.tsx` | Icon-only button with aria-label | 4 |
| `src/features/kaira/components/TypingIndicator.tsx` | Animated bouncing dots typing indicator | 5 |
| `src/features/kaira/components/SuggestedPrompts.tsx` | Clickable prompt suggestion chips | 5 |

### Files to Modify — By Phase

#### Phase 1: Token Expansion
| File | Changes |
|------|---------|
| `src/styles/globals.css` | Add ~50 new tokens (verdict, level, accent palette, surface, border-status, chat, code, layout) |

#### Phase 2: Hardcoded Color Removal
| File | Changes |
|------|---------|
| `src/config/labelDefinitions.ts` | Replace 40+ hardcoded hex with `STATUS_COLORS.*` / `CATEGORY_ACCENT_COLORS.*` |
| `src/utils/evalColors.ts` | Replace with thin re-export from `statusColors.ts` |
| `src/features/kaira/components/MessageTagBadge.tsx` | Replace 10 RGB color sets with CSS var + `color-mix()` |

#### Phase 3: Eval Runs Full Theme Migration (~15 files)
| File | Changes |
|------|---------|
| `src/features/evalRuns/pages/Dashboard.tsx` | Replace all slate/white → CSS vars; use `<Alert>`, `<EmptyState>`, `<SkeletonCard>` |
| `src/features/evalRuns/pages/RunList.tsx` | Replace all slate/indigo → CSS vars; add skeletons |
| `src/features/evalRuns/pages/RunDetail.tsx` | Major: all colors, font sizes, search input, view toggle, filters → themed |
| `src/features/evalRuns/pages/ThreadDetail.tsx` | Replace all slate/indigo → CSS vars; use `<Tabs>` |
| `src/features/evalRuns/pages/AdversarialDetail.tsx` | Replace all white/slate/red → CSS vars |
| `src/features/evalRuns/pages/Logs.tsx` | Replace all colors; use `<Alert>`, chevron icons for expand; skeletons |
| `src/features/evalRuns/components/RunCard.tsx` | `hover:border-indigo-200` → CSS var; use `Card` wrapper |
| `src/features/evalRuns/components/EvalTable.tsx` | All slate → CSS vars; hex border colors → `STATUS_COLORS` |
| `src/features/evalRuns/components/DistributionBar.tsx` | `bg-slate-100` → CSS var; verify `getVerdictColor()` |
| `src/features/evalRuns/components/TrendChart.tsx` | Grid/axis colors → `resolveColor()` hook |
| `src/features/evalRuns/components/Tooltip.tsx` | `bg-slate-900` + arrow → CSS vars |
| `src/features/evalRuns/components/TranscriptViewer.tsx` | User/bot bubble colors → CSS vars |
| `src/features/evalRuns/components/MetricInfo.tsx` | `text-slate-400` → CSS var |
| `src/features/evalRuns/components/RuleComplianceGrid.tsx` | Emerald/red → CSS vars |
| `src/features/evalRuns/components/VerdictBadge.tsx` | Verify uses CSS vars for colors |

#### Phase 4: Component Library
| File | Changes |
|------|---------|
| `src/components/ui/Badge.tsx` | Add `size`, `dot`, `icon` props |
| `src/components/ui/Button.tsx` | Add `icon`, `iconOnly` props |
| `src/components/ui/Skeleton.tsx` | Add `SkeletonCard`, `SkeletonTableRow`, `SkeletonMessage` variants |
| `src/components/ui/index.ts` | Export all new components |

#### Phase 5: Chat UX Redesign
| File | Changes |
|------|---------|
| `src/features/kaira/components/ChatMessage.tsx` | Redesign layout, avatars (32px), spacing, markdown styling, message grouping |
| `src/features/kaira/components/ChatInput.tsx` | Unified container, inline send button, focus-only helper text |
| `src/features/kaira/components/ChatMessageList.tsx` | Add `ScrollToBottom`, remove `divide-y`, add gap spacing |
| `src/features/kaira/components/ChatView.tsx` | Use `<Alert>` for errors, `<EmptyState>` + `<SuggestedPrompts>` |
| `src/features/kaira/components/NoticeBox.tsx` | Compose using `<Alert>` internally |
| `src/features/kaira/components/ActionButtons.tsx` | Polish button sizing and disabled state |
| `src/features/kaira/components/ChatSessionList.tsx` | Polish session list styling |

#### Phase 6: All Other Pages
| File | Changes |
|------|---------|
| `src/app/pages/ListingPage.tsx` | Replace hardcoded calc, use `<Alert>`, `<EmptyState>` |
| `src/features/evals/components/EvaluatorsView.tsx` | Loading skeletons, `<EmptyState>` |
| `src/features/evals/components/EvaluatorHistoryListOverlay.tsx` | `text-blue-600` → CSS var |
| `src/features/evals/components/EvaluatorHistoryDetailsOverlay.tsx` | Hardcoded red → CSS var |
| `src/features/voiceRx/components/EnhancedJsonViewer.tsx` | `dark:bg-yellow-700` → CSS var |
| `src/features/settings/components/SettingsPage.tsx` | Add z-index to fixed buttons |
| `src/features/kairaBotSettings/components/KairaBotSettingsPage.tsx` | Emoji → lucide icon |
| `src/features/kairaBotSettings/components/TagManagementPage.tsx` | Use `<EmptyState>` for zero tags |
| `src/features/kaira/components/TraceMessageRow.tsx` | Fix `text-[10px]` → 11px min; theme badge colors |
| `src/features/kaira/components/TraceStatisticsBar.tsx` | Standardize icon sizes |
| `src/features/transcript/components/TranscriptZeroState.tsx` | Use `<EmptyState>` |

#### Phase 7: Dark Mode Polish
| File | Changes |
|------|---------|
| `src/app/ThemeProvider.tsx` | Add `data-theme-transitioning` class for smooth transitions |
| `src/features/kaira/components/ChatMessage.tsx` | Remove `dark:prose-invert`, fully CSS var controlled |

### Files to Delete / Consolidate

| File | Reason |
|------|--------|
| `src/utils/evalColors.ts` | Replaced by thin re-export from `statusColors.ts` (or inline the re-export) |

---

## 12. Design Decisions & Rationale

### Why CSS Variables Over Tailwind Classes for Color Tokens?

The codebase already uses this pattern. CSS variables enable:
- Runtime theme switching (no class-based dark mode)
- JavaScript access for chart libraries (Recharts)
- Single source of truth in `globals.css`
- Smaller class strings in components

### Why Not Use `dark:` Tailwind Classes?

The project uses `data-theme="dark"` attribute, not Tailwind's `dark:` class. This is the correct architecture for runtime theme switching with system preference detection. All new code should follow this pattern.

### Why a `resolveColor()` Helper for Charts?

Recharts renders to SVG/Canvas and doesn't support CSS `var()` in all attributes. The helper resolves the computed value at runtime and re-resolves on theme change via a MutationObserver.

### Why Separate Alert vs NoticeBox?

`NoticeBox` is chat-specific (parses `<notice>` HTML from API responses). `Alert` is a general-purpose UI component used across the app for errors, warnings, confirmations. They share visual style but have different APIs and use cases. `NoticeBox` should internally compose `Alert` for rendering.

### Why Not shadcn/ui?

The project has a working custom component library. Migrating to shadcn would be a large rewrite with no clear benefit, since the custom components already follow the same patterns (variants, sizes, `cn()` utility). The plan enhances the existing library rather than replacing it.

### Why Suggested Prompts in Chat?

Empty chat screens waste space and create friction. Suggested prompts give users immediate action options, demonstrate Kaira's capabilities, and feel modern (see: ChatGPT, Claude, Gemini — all use this pattern).

---

---

## Estimated Effort

| Phase | Description | Files | Effort | Priority |
|-------|-------------|-------|--------|----------|
| 1 | Token system expansion | 1 file (`globals.css`) | Small | P0 — Foundation |
| 2 | Remove hardcoded colors (configs/utils) | ~4 files | Small-Medium | P0 — Foundation |
| 3 | **Eval runs full theme migration** | **~15 files** | **Large** | **P1 — Highest visual impact** |
| 4 | Component library hardening | ~9 new + 3 enhanced | Medium | P1 — Enables other phases |
| 5 | Kaira chat UX redesign | ~10 files | Large | P2 — Major UX improvement |
| 6 | All other pages cleanup | ~12 files | Medium | P2 — Completeness |
| 7 | Dark mode polish + transitions | ~3 files | Small | P3 — Polish |
| 8 | Global visual polish | Audit all components | Medium | P3 — Polish |

### Recommended Implementation Order

```
Phase 1 (tokens) → Phase 2 (color constants)
    ↓
Phase 4 (new components: Alert, EmptyState, StatusDot, Skeleton, IconButton)
    ↓
Phase 3 (eval runs migration — uses new components)
    ↓
Phase 5 (chat redesign — uses new components)
    ↓
Phase 6 (all other pages — uses new components)
    ↓
Phase 7 (dark mode) → Phase 8 (global polish)
```

Build tokens and components first. Then migrate pages. Polish last.

### Total Files Touched

- **New files:** 9
- **Modified files:** ~45
- **Deleted files:** 0-1

### Key Risk

The eval runs migration (Phase 3) is the biggest bang-for-buck but also the most tedious — it's a systematic find-and-replace across 15 files. Consider doing it file-by-file with visual testing after each page.
