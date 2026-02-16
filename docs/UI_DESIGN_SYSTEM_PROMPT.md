# Execution Prompt — UI Design System Overhaul

> Copy-paste this as your prompt to the executing LLM. Adjust phase selection as needed.

---

## THE PROMPT

```
Read `docs/UI_DESIGN_SYSTEM_PLAN.md` in full. This is a comprehensive, pre-audited plan for overhauling the UI design system of this React + Tailwind v4 + FastAPI platform. Every file, every hardcoded color, every component change has been identified and documented.

Your job is to implement this plan. Work phase by phase, in order. After each phase, stop and confirm before moving to the next.

## RULES

1. **Follow the plan exactly.** The plan was produced from a deep audit of every file. Do not freelance or add things not in the plan.
2. **Do not break existing functionality.** This is a styling-only refactor. No logic changes. No API changes. No route changes.
3. **Test after each phase.** Run `npm run build` (or the project's build command) after each phase to verify TypeScript compilation passes. If it fails, fix before proceeding.
4. **Commit after each phase.** Create a git commit with message like "ui: phase N — <description>".
5. **Use CSS variables, not Tailwind color classes** for theming. The project uses `data-theme="dark"` attribute switching, NOT Tailwind's `dark:` class-based system. All colors must respond to theme via `var(--token-name)`.
6. **Preserve the `cn()` utility pattern.** All className composition must use `cn()` from `@/utils`.
7. **Do not create documentation files** beyond what's specified.
8. **Icon sizes follow this scale:**
   - Button sm: `h-3.5 w-3.5`
   - Button md: `h-4 w-4`
   - Button lg: `h-4.5 w-4.5`
   - Badge: `h-3 w-3`
   - Inline text: `h-3.5 w-3.5`
   - Empty state: `h-6 w-6`
   - Page title: `h-5 w-5`

## PHASE EXECUTION ORDER

### Phase 1: Token Expansion
- Edit `src/styles/globals.css`
- Add all new tokens listed in plan section 3 (verdict, level, accent palette, surfaces, border-status, chat, code, layout tokens)
- Add both `:root` (light) and `[data-theme="dark"]` variants
- Verify build passes

### Phase 2: Centralized Color Constants
- Create `src/utils/statusColors.ts` with `STATUS_COLORS`, `CATEGORY_ACCENT_COLORS`, `resolveColor()` as specified in plan section 4.1
- Create `src/hooks/useResolvedColor.ts` with the MutationObserver-based hook for Recharts compatibility
- Refactor `src/config/labelDefinitions.ts` — replace all 40+ hardcoded hex values with imports from `statusColors.ts`
- Refactor `src/utils/evalColors.ts` — thin re-export from `statusColors.ts`
- Refactor `src/features/kaira/components/MessageTagBadge.tsx` — replace RGB array with CSS var references using `color-mix()`
- Verify build passes

### Phase 3: Eval Runs Theme Migration
This is the biggest phase. Work file by file through plan section 5.

For EVERY file in `src/features/evalRuns/`:
- Replace `bg-white` → `bg-[var(--bg-primary)]`
- Replace `bg-slate-50` variants → `bg-[var(--bg-secondary)]`
- Replace `bg-slate-100` → `bg-[var(--bg-tertiary)]`
- Replace `border-slate-200` → `border-[var(--border-subtle)]`
- Replace `text-slate-400` → `text-[var(--text-muted)]`
- Replace `text-slate-500/600` → `text-[var(--text-secondary)]`
- Replace `text-slate-700/800/900` → `text-[var(--text-primary)]`
- Replace `bg-indigo-50` → `bg-[var(--surface-info)]`
- Replace `text-indigo-*` → `text-[var(--color-info)]`
- Replace `bg-red-50` → `bg-[var(--surface-error)]`
- Replace `text-red-*` → `text-[var(--color-error)]`
- Replace `bg-emerald-50` → `bg-[var(--surface-success)]`
- Replace non-scale font sizes (`text-[0.65rem]`, `text-[0.72rem]`, `text-[0.78rem]`) with `text-[var(--text-xs)]` or `text-[var(--text-sm)]`
- Replace hex colors in inline `borderLeftColor` styles with `STATUS_COLORS.*` or `CATEGORY_ACCENT_COLORS.*`
- For TrendChart: use `useResolvedColor()` hook for Recharts attributes
- For evalRuns/Tooltip: replace `bg-slate-900 text-white` with `bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-default)] shadow-lg`

Files to touch (in order):
1. `components/VerdictBadge.tsx`
2. `components/MetricInfo.tsx`
3. `components/Tooltip.tsx`
4. `components/DistributionBar.tsx`
5. `components/RuleComplianceGrid.tsx`
6. `components/TranscriptViewer.tsx`
7. `components/TrendChart.tsx`
8. `components/EvalTable.tsx`
9. `components/EvalSection.tsx`
10. `components/RunCard.tsx`
11. `pages/Dashboard.tsx`
12. `pages/RunList.tsx`
13. `pages/RunDetail.tsx`
14. `pages/ThreadDetail.tsx`
15. `pages/AdversarialDetail.tsx`
16. `pages/Logs.tsx`

Verify build passes after this phase.

### Phase 4: Component Library
Create these new components as specified in plan section 6:
1. `src/components/ui/Alert.tsx` — 4 variants (info/success/warning/error), left border accent, surface bg, lucide icon, optional dismiss
2. `src/components/ui/StatusDot.tsx` — colored dot with optional pulse and label
3. `src/components/ui/EmptyState.tsx` — centered icon circle + title + description + optional action button
4. `src/components/ui/IconButton.tsx` — square icon button with aria-label, 3 sizes, 4 variants
5. `src/components/ui/ScrollToBottom.tsx` — floating button with ArrowDown icon, optional unread badge

Enhance existing:
6. `src/components/ui/Skeleton.tsx` — add `SkeletonCard`, `SkeletonTableRow`, `SkeletonMessage` exports
7. `src/components/ui/Badge.tsx` — add `size` prop (sm/md), optional `icon` prop, optional `dot` prop
8. `src/components/ui/Button.tsx` — add `icon` prop (LucideIcon), `iconOnly` prop (boolean for square buttons)

Export all new components from `src/components/ui/index.ts`.

Verify build passes.

### Phase 5: Kaira Chat UX Redesign
Follow plan section 7 exactly:

1. **ChatMessage.tsx**: Avatar h-7→h-8, icon h-3.5→h-4, padding px-4 py-3→px-5 py-4, gap 2.5→3, bot msg gets rounded-lg + shadow-sm, user msg gets subtle left border, remove prose dark:prose-invert, use CSS vars for all markdown component colors
2. **Create TypingIndicator.tsx**: Three bouncing dots with staggered animation
3. **ChatInput.tsx**: Wrap textarea+button in single bordered container, send button moves inside (36px circle), helper text shows on focus only with fade, reduce max-height to 160px
4. **ChatMessageList.tsx**: Remove divide-y, add gap spacing, integrate ScrollToBottom with IntersectionObserver
5. **ChatView.tsx**: Error banner → `<Alert variant="error">`, empty state → `<EmptyState>` + `<SuggestedPrompts>`
6. **Create SuggestedPrompts.tsx**: 3-4 clickable prompt chips
7. **NoticeBox.tsx**: Compose using `<Alert>` internally
8. **ActionButtons.tsx**: Polish sizing, improve disabled state opacity

Verify build passes.

### Phase 6: All Other Pages
Follow plan section 8 page by page:
- Fix any remaining hardcoded Tailwind color classes → CSS vars
- Replace ad-hoc error boxes → `<Alert>`
- Replace inline empty states → `<EmptyState>`
- Replace "Loading..." text → `<Skeleton>` variants
- Fix `dark:bg-yellow-700` in EnhancedJsonViewer → CSS var
- Fix `text-blue-600 dark:text-blue-400` in EvaluatorHistoryListOverlay → CSS var
- Replace emoji icons → lucide icons
- Fix TraceMessageRow `text-[10px]` → 11px minimum

Verify build passes.

### Phase 7: Dark Mode Polish
- In ThemeProvider.tsx: Add `data-theme-transitioning` attribute during theme switch, remove after 300ms
- In globals.css: Add `html[data-theme-transitioning] *` transition rule
- Verify all status colors have sufficient contrast in dark mode
- Remove any remaining `dark:` Tailwind classes that conflict with the `data-theme` system

Verify build passes.

### Phase 8: Global Polish Pass
Final sweep across all files:
- Enforce typography scale (plan section 10.1)
- Standardize spacing (plan section 10.2)
- Ensure border/shadow consistency (plan section 10.3)
- Add `transition-colors duration-150` to all interactive elements missing it
- Ensure all focusable elements have `focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]`
- Standardize icon sizes per the scale above

Final build verification.

## IMPORTANT CONTEXT
- Tailwind v4 with `@tailwindcss/vite` plugin — no separate tailwind.config.js
- Theme is `data-theme="dark"` on `<html>`, NOT Tailwind `dark:` class
- All components use `cn()` from `@/utils` for className composition
- `lucide-react` is the ONLY icon library — do not add others
- Recharts needs resolved hex values — use `resolveColor()` / `useResolvedColor()` hook, NOT raw `var()` strings
- The `@theme` directive in globals.css is Tailwind v4's way of defining design tokens
- CSS vars defined in `:root` / `[data-theme="dark"]` are the semantic layer on top of `@theme` primitives
```
