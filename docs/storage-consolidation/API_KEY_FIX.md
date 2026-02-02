# API Key Recognition Bug Fix

## Issue
AI Transcript Evaluation was not recognizing the API key from settings in Voice-RX. Similarly, Kaira structured extraction had the same issue.

## Root Cause
Both `useAIEvaluation` and `useStructuredExtraction` hooks were destructuring settings from the store at hook initialization:

```typescript
// PROBLEM: Destructured values captured in closure
const { llm, transcription } = useSettingsStore();

const evaluate = useCallback(async () => {
  if (!llm.apiKey) {  // Uses stale closure value!
    // ...
  }
  // ...
}, [llm.apiKey, llm.selectedModel, ...]);
```

When the API key was set after component mount, the `llm` object reference in the closure remained stale. The dependency array would trigger re-creation of the callback, but if the component didn't re-render between setting the API key and calling `evaluate()`, it would still use the old closure.

## Solution
Use `useSettingsStore.getState()` to fetch fresh values inside the callback:

```typescript
// FIXED: Get fresh values each time
const evaluate = useCallback(async () => {
  const llm = useSettingsStore.getState().llm;  // Fresh value!
  
  if (!llm.apiKey) {
    // ...
  }
  // ...
}, [addTask, setTaskStatus, ...]); // No llm in dependencies
```

This ensures the callback always uses the current API key, regardless of when it was set.

## Files Modified

### Voice-RX Evaluation
**File:** `src/features/evals/hooks/useAIEvaluation.ts`

**Changes:**
1. Removed `const { llm, transcription } = useSettingsStore()` destructuring
2. Added `const llm = useSettingsStore.getState().llm` inside `evaluate` callback
3. Removed `llm.apiKey`, `llm.selectedModel`, `transcription` from dependency array

### Kaira Structured Extraction
**File:** `src/features/structured-outputs/hooks/useStructuredExtraction.ts`

**Changes:**
1. Removed `const { llm } = useSettingsStore()` destructuring
2. Added `const llm = useSettingsStore.getState().llm` inside both `extract` and `regenerate` callbacks
3. Removed `llm.apiKey`, `llm.selectedModel` from both dependency arrays

## Pattern

This is part of a larger pattern we've identified and fixed throughout the codebase:

**❌ ANTI-PATTERN:**
```typescript
const { method } = useStore();  // Destructuring creates unstable reference
useEffect(() => {
  method();
}, [method]);  // Triggers on every render
```

**✅ CORRECT:**
```typescript
const method = useStore((state) => state.method);  // Stable selector
useEffect(() => {
  method();
}, [method]);
```

**✅ ALSO CORRECT (for callbacks):**
```typescript
const callback = useCallback(() => {
  const value = useStore.getState().value;  // Fresh value each call
  // use value
}, []);  // No store values in deps
```

## Testing
1. **Scenario 1:** Fresh app start
   - Open app (no API key set)
   - Go to Settings → Set API key
   - Return to Voice-RX → Start evaluation
   - **Expected:** Evaluation proceeds (uses current API key)
   - **Previous bug:** "API key not configured" error

2. **Scenario 2:** API key change mid-session
   - App running with API key A
   - Go to Settings → Change to API key B
   - Start new evaluation
   - **Expected:** Uses API key B
   - **Previous bug:** Might use stale API key A

3. **Scenario 3:** Kaira extraction
   - Same scenarios as above for Kaira's structured extraction
   - **Expected:** Both extract() and regenerate() use current API key

## Related Fixes
This is the third instance of this pattern we've fixed during storage consolidation:

1. **Fix 1:** `useCurrentAppData.ts` - Fixed destructured method causing infinite loops
2. **Fix 2:** `useAIEvaluation.ts` and `useStructuredExtraction.ts` - Fixed taskQueue destructuring
3. **Fix 3 (this):** Both hooks - Fixed llm config destructuring

## Commits
- `413cb07` - fix: use fresh settings values in evaluate callback to get current API key
- `cc63ac8` - fix: use fresh settings values in Kaira extraction hooks

## Impact
- **Voice-RX:** AI evaluation now correctly recognizes API key from settings
- **Kaira:** Structured extraction now correctly recognizes API key from settings
- **Both:** No more stale closure bugs from settings changes
- **Build:** All builds pass, no TypeScript errors
