# Show in Header Implementation

## Summary
Implemented the "Show in Header" toggle feature for evaluators that allows users to dynamically display/hide evaluator metrics in the listing page header.

## Changes Made

### 1. Added `handleToggleHeader` Function
**File**: `src/features/evals/components/EvaluatorsView.tsx`

Added handler that:
- Toggles the `showInHeader` boolean on the evaluator
- Updates the timestamp
- Persists to database via `updateEvaluator()`
- Shows success notification

### 2. Wired Up Toggle to Card
**File**: `src/features/evals/components/EvaluatorsView.tsx`

Passed `onToggleHeader={handleToggleHeader}` prop to each `EvaluatorCard` component.

### 3. Created EvaluatorMetrics Component
**File**: `src/features/evals/components/EvaluatorMetrics.tsx`

New component that:
- Loads evaluators from store
- Filters evaluators where `showInHeader === true`
- Displays metrics in compact card style (similar to existing MetricsBar)
- Shows main metric value from latest completed run
- Uses color-coded styling based on score:
  - 90%+ → Emerald (excellent)
  - 70-90% → Green (good)
  - 50-70% → Amber (warning)
  - <50% → Red (critical)
- Includes progress bar for numeric metrics
- Handles all field types: number, text, boolean, array

### 4. Integrated into Header
**File**: `src/app/pages/ListingPage.tsx`

Added `<EvaluatorMetrics listing={listing} />` component below the existing `<MetricsBar>` in the page header.

### 5. Menu Item Already Existed
**File**: `src/features/evals/components/EvaluatorCard.tsx`

The "Show in Header" menu item was already implemented with:
- Conditional checkmark icon (green when active, gray when inactive)
- Calls `onToggleHeader(evaluator.id, !evaluator.showInHeader)`

## How It Works

### User Flow
1. User creates/runs an evaluator
2. User clicks 3-dot menu on evaluator card
3. User clicks "Show in Header" option
4. Evaluator definition updated in database with `showInHeader: true`
5. Header automatically displays the metric (via React reactivity)
6. User can toggle off to remove from header

### Technical Flow
1. `EvaluatorCard` calls `onToggleHeader(evaluatorId, newState)`
2. `EvaluatorsView.handleToggleHeader()` updates evaluator in store
3. Store persists to `entities` table via `evaluatorsRepository.save()`
4. `EvaluatorMetrics` component re-renders (watches store)
5. Filters evaluators by `showInHeader === true`
6. Finds corresponding run from `listing.evaluatorRuns[]`
7. Renders compact metric card with score and progress bar

### Data Flow
```
User clicks menu
  ↓
EvaluatorCard.onToggleHeader(id, true)
  ↓
EvaluatorsView.handleToggleHeader(id, true)
  ↓
evaluatorsStore.updateEvaluator({ ...evaluator, showInHeader: true })
  ↓
evaluatorsRepository.save(evaluator)
  ↓
IndexedDB entities table updated
  ↓
Store reactivity triggers re-render
  ↓
EvaluatorMetrics filters and displays
```

## Design Decisions

### 1. No Hardcoding
- Metrics are dynamically filtered by `showInHeader` flag
- No fixed list of evaluator IDs
- Works for any number of evaluators

### 2. Graceful Degradation
- If no evaluators have `showInHeader: true`, component renders nothing
- If evaluator hasn't run yet, it won't show in header (needs completed run)
- If run failed, doesn't show in header

### 3. Consistent Styling
- Uses existing design system variables
- Matches `MetricCard` compact style
- Color-coded for quick scanning
- Progress bar provides visual feedback

### 4. Persistence
- Stored in evaluator definition (not listing)
- Survives page reloads
- Per-evaluator setting (not per-listing)

## Testing Checklist

- [x] Build succeeds with no TypeScript errors
- [ ] Toggle menu item shows checkmark when active
- [ ] Clicking toggle persists change to database
- [ ] Header displays metric when toggle is ON
- [ ] Header hides metric when toggle is OFF
- [ ] Multiple evaluators can show in header simultaneously
- [ ] Color coding matches score ranges
- [ ] Progress bar animates correctly
- [ ] Works with all field types (number, text, boolean, array)
- [ ] Handles edge cases (no runs, failed runs, incomplete data)

## Files Modified

1. `src/types/evaluator.types.ts` - Added `showInHeader?: boolean`
2. `src/features/evals/components/EvaluatorsView.tsx` - Added toggle handler
3. `src/features/evals/components/EvaluatorCard.tsx` - Wired toggle prop
4. `src/features/evals/components/EvaluatorMetrics.tsx` - NEW component
5. `src/features/evals/components/index.ts` - Export new component
6. `src/app/pages/ListingPage.tsx` - Integrated into header

## Build Status

✅ TypeScript compilation succeeds  
✅ Vite build succeeds (8.53s)  
✅ Dev server starts successfully

## Next Steps

User should:
1. Start dev server: `npm run dev`
2. Navigate to a listing with transcript
3. Go to "Evaluators" tab
4. Create an evaluator with output schema
5. Run the evaluator
6. Click 3-dot menu → "Show in Header"
7. Verify metric appears in page header
8. Toggle off and verify it disappears
