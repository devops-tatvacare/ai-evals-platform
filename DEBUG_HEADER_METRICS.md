# Debug: Header Metrics Not Showing

## Changes Made
1. Fixed Zustand selector usage in `EvaluatorMetrics.tsx` - now uses individual selectors instead of destructuring
2. Added console.log debugging in both components

## What to Check in Browser Console

### When You Toggle "Show in Header":

**Expected Console Output:**
```
[EvaluatorsView] Toggle header: {
  evaluatorId: "xxx",
  evaluatorName: "Your Evaluator Name",
  oldValue: false,
  newValue: true
}
[EvaluatorsView] Updated evaluator: { ...full evaluator object with showInHeader: true }
```

**Then on next render:**
```
[EvaluatorMetrics] Debug: {
  totalEvaluators: 1,
  headerEvaluators: 1,
  evaluators: [{ id: "xxx", name: "...", showInHeader: true }],
  listingRuns: 1
}
```

## Debugging Steps

### 1. Check if evaluator has a completed run
- Go to Evaluators tab
- Find your evaluator
- Click "Run" button
- Wait for "Completed" status with green checkmark

### 2. Check if showInHeader is true
- Click 3-dot menu on evaluator card
- Click "Show in Header"
- Look for green checkmark next to "Show in Header" in menu
- Check console for toggle logs

### 3. Check EvaluatorMetrics debug output
**Open browser console** (F12 or Cmd+Option+I)

Look for: `[EvaluatorMetrics] Debug:`

**If headerEvaluators: 0**
- Check if `evaluators` array shows `showInHeader: true`
- If yes → Store updated but component not filtering correctly
- If no → Store not updating (check toggle handler logs)

**If listingRuns: 0**
- The listing doesn't have evaluator runs yet
- Run the evaluator first

**If totalEvaluators: 0**
- Evaluators not loaded from database
- Check if `loadEvaluators()` was called
- Check IndexedDB (Application tab → IndexedDB → db → entities)

### 4. Check IndexedDB Directly
**Browser DevTools → Application → IndexedDB → db → entities**

Filter for `type === "evaluator"`:
- Find your evaluator record
- Check `data.showInHeader` field
- Should be `true` after toggling

### 5. Check Listing Data
**In console, type:**
```javascript
// Find the listing object in React DevTools or:
console.log('Current listing:', listing);
```

Check:
- `listing.evaluatorRuns` - should have array with runs
- Each run should have: `evaluatorId`, `status: 'completed'`, `output: {...}`

## Common Issues

### Issue 1: Store not updating
**Symptom:** Toggle shows notification but console shows old value
**Fix:** Check if `updateEvaluator()` is being called and awaited

### Issue 2: Component not re-rendering
**Symptom:** Store updates but component doesn't show new data
**Fix:** Already fixed with individual selectors. If still happens, check if `evaluators` dependency is in the filter logic

### Issue 3: No main metric defined
**Symptom:** evaluator shows in filter but card doesn't render
**Check console for:** `mainMetricField: undefined`
**Fix:** Edit evaluator, ensure one output field has "Main Metric" selected

### Issue 4: Run not completed
**Symptom:** Card shows but status is not "completed"
**Check:** Card should show green checkmark icon
**Fix:** Wait for run to complete or re-run if failed

### Issue 5: Value is undefined
**Symptom:** Run completed but output doesn't have the metric field
**Check console:** `value: undefined`
**Fix:** Check LLM response - might not be returning the expected field

## Quick Test

Run this in console after toggling header:
```javascript
// Access the store directly
const store = window.__ZUSTAND_STORES__?.evaluatorsStore; // If exposed
// OR use React DevTools to inspect <EvaluatorMetrics> component props and state
```

## Expected Behavior

✅ Toggle "Show in Header" ON
✅ See notification: "Evaluator added to header"
✅ Console logs show showInHeader: true
✅ EvaluatorMetrics debug shows headerEvaluators: 1
✅ Small metric card appears below MetricsBar in header
✅ Card shows evaluator name and score
✅ Progress bar displays (for numeric metrics)

## If Still Not Working

Check these files to ensure changes are applied:

1. `src/features/evals/components/EvaluatorMetrics.tsx` - Has console.log on line ~20
2. `src/features/evals/components/EvaluatorsView.tsx` - Has console.log in handleToggleHeader
3. `src/app/pages/ListingPage.tsx` - Has `<EvaluatorMetrics listing={listing} />` after MetricsBar

If all checks pass but still not showing, try:
- Hard refresh (Cmd+Shift+R / Ctrl+Shift+F5)
- Clear IndexedDB and recreate evaluator
- Check if there's a CSS issue hiding the component (inspect DOM)
