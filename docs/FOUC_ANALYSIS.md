# Page Load Flash (FOUC) Analysis

## Screenshots
Extracted from Chrome Performance traces provided by user:
- Light mode trace: `/Users/dhspl/Downloads/Profile-20260217T150610-light.json.gz`
- Dark mode trace: `/Users/dhspl/Downloads/Profile-20260217T150529-dark.json.gz`

## Frame-by-Frame Timeline (from traces)

| Frame | Time (ms) | What's Visible |
|-------|-----------|----------------|
| 0 | 308 | Dark background only (inline script working) |
| 1 | 484 | **FLASH** — Everything renders in LIGHT mode. Sidebar shows "No evaluations yet" empty state. Main content shows light-colored skeletons |
| 3 | 507 | Sidebar switches from empty state to skeleton bars |
| 12 | 687 | Real content starts appearing — listing title, tabs, 3 skeleton cards on evaluators tab |
| 13 | 730 | Final state — evaluator card ("Medical Entity Recall") appears |

Both "light" and "dark" traces show identical screenshots/timing, confirming dark mode CSS variables are NOT applied during first React paint.

## Root Causes Identified

### 1. Skeleton uses hardcoded light-only color
**File**: `src/components/ui/Skeleton.tsx`
**Problem**: `bg-[var(--color-neutral-200)]` resolves to `#E8E7EE` (light gray) regardless of theme.
In dark mode, skeletons appear as bright light blocks on dark background — the primary visual "flash."

**Status**: FIXED — Changed to `bg-[var(--bg-tertiary)]` which resolves correctly per theme:
- Light: `#F5F4F9` (blends with light bg)
- Dark: `#363642` (blends with dark bg)

### 2. `isLoading` defaults to `false` in listingsStore
**File**: `src/stores/listingsStore.ts`
**Problem**: Store initializes with `isLoading: false`. The sidebar component (`VoiceRxSidebarContent.tsx:95`) checks this flag — when `false` and listings array is empty, it shows "No evaluations yet" empty state instead of skeletons.

The `useListingsLoader` hook sets `isLoading = true` in a `useEffect`, which only fires AFTER the first render. So the render sequence is:
1. First render: `isLoading=false`, listings=[] → **shows empty state** (the "0 state box" flash)
2. useEffect fires: `isLoading=true` → shows skeletons
3. API response: `isLoading=false`, listings populated → shows real entries

**Status**: FIXED — Changed default to `isLoading: true`. Now the sequence is:
1. First render: `isLoading=true` → shows skeletons immediately
2. API response: `isLoading=false` → shows real entries

### 3. CSS variables not available during first React paint
**File**: `src/styles/globals.css` loaded via `import '@/styles/globals.css'` in `src/main.tsx`
**Problem**: In Vite dev mode (especially Docker), CSS is processed by `@tailwindcss/vite` plugin and injected as a `<style>` tag via JS HMR module. There's a window where React paints components before CSS custom properties are computed/applied.

**Status**: FIXED — Created `public/critical-theme.css` with all theme variables (palette, semantic tokens, dark mode overrides, body base styles) as plain CSS. Loaded via `<link rel="stylesheet" href="/critical-theme.css">` in `index.html` `<head>`, after the inline theme script. Since `<link>` in `<head>` is render-blocking, the browser won't paint until these variables are available. The same variables in `globals.css` re-declare them with identical values when Tailwind loads — no conflict.

## Additional Notes from Performance Traces

- **Evaluators API cascade**: Fixed in previous session. `ListingPage.tsx` now pre-fetches evaluators in parallel with listing load (fire-and-forget call to `useEvaluatorsStore.getState().loadEvaluators()`).
- **Dedup guard**: Added `_loadingListingId` tracking in `evaluatorsStore.ts` to prevent duplicate API calls from React StrictMode.
- **Layout-matching skeleton**: `ListingPage.tsx` loading skeleton now matches actual page structure to minimize layout shift.
- **Network timing**: Listings API response at ~591ms, evaluators at ~665ms (was 180ms cascade, now parallel).

## Files Modified (kept)
- `src/components/ui/Skeleton.tsx` — `bg-[var(--bg-tertiary)]` instead of `bg-[var(--color-neutral-200)]`
- `src/stores/listingsStore.ts` — `isLoading: true` default
- `public/critical-theme.css` — Render-blocking plain CSS with all theme variables
- `index.html` — Added `<link rel="stylesheet" href="/critical-theme.css">` in `<head>`
