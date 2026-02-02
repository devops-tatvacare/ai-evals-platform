# EvaluationModal Infinite Loop Bug Fix

## Issues Reported
1. **Unable to update prompt in text box** - Text would reset while typing
2. **Unable to switch to evaluation tab** - Tab switching triggered state reset

## Root Causes

### 1. Destructured Store Reference (Line 66)
```typescript
// ❌ PROBLEM: Creates new object reference on every store update
const { llm } = useSettingsStore();
```

When `llm` is destructured, any update to the settings store creates a new object reference. This new reference is captured in useEffect dependencies, causing the effect to re-run.

### 2. Array Dependencies in useEffect (Line 188)
```typescript
// ❌ PROBLEM: Arrays change identity every render
useEffect(() => {
  // Reset prompts and schemas...
}, [schemas, prompts]); // Arrays are new objects each render
```

The `schemas` and `prompts` arrays from `useCurrentSchemas()` and `useCurrentPrompts()` are new arrays on every render, even if their contents are the same. Including them in dependencies caused the effect to run constantly.

### 3. Unstable Function Reference (Line 72)
```typescript
// ❌ PROBLEM: New function every render
const { getPrompt } = useCurrentPromptsActions(); // Returns new object each time
```

`useCurrentPromptsActions()` returns a new object with arrow functions on every render. When `getPrompt` is included in useCallback dependencies, it causes the callback to be recreated constantly.

## The Infinite Loop Chain

```
1. Component renders
   ↓
2. useSettingsStore() returns new { llm } object
   ↓
3. useEffect deps see new llm reference
   ↓
4. useEffect runs → resets transcriptionPrompt/evaluationPrompt state
   ↓
5. State change triggers re-render
   ↓
6. Back to step 1 → INFINITE LOOP
```

**User Impact:**
- Typing in textarea triggers infinite loop
- Each keystroke causes state reset
- Text appears to "fight back" against user input
- Tab switching also triggers reset, preventing navigation

## Solution

### 1. Use Stable Selector (Line 67)
```typescript
// ✅ FIXED: Stable reference unless llm changes
const llm = useSettingsStore((state) => state.llm);
```

Zustand selectors return the same reference until the selected value actually changes.

### 2. Use Specific IDs in Dependencies (Line 183)
```typescript
// ✅ FIXED: Only re-run when specific IDs change
useEffect(() => {
  // ...
}, [
  isOpen,
  listing.aiEval?.schemas?.transcription?.id,  // Primitive value
  listing.aiEval?.schemas?.evaluation?.id,     // Primitive value
  llm.defaultSchemas?.transcription,           // Primitive value
  llm.defaultSchemas?.evaluation,              // Primitive value
  // No schemas or prompts arrays!
]);
```

Instead of depending on entire objects/arrays, we depend on the specific primitive values (IDs) that determine whether we need to reload.

### 3. Use Store Selector Directly (Line 71)
```typescript
// ✅ FIXED: Stable selector from store
const getPromptFromStore = usePromptsStore((state) => state.getPrompt);

const getInitialTranscriptionPrompt = useCallback(() => {
  const activePrompt = getPromptFromStore(appId, activePromptId);
  // ...
}, [appId, getPromptFromStore]); // Stable dependencies
```

Direct store selectors are stable and won't change unless the store implementation changes.

## Files Modified

**File:** `src/features/evals/components/EvaluationModal.tsx`

**Changes:**
1. Line 67: Changed `const { llm } = useSettingsStore()` to `const llm = useSettingsStore((state) => state.llm)`
2. Line 71: Added `const getPromptFromStore = usePromptsStore((state) => state.getPrompt)`
3. Lines 76-109: Updated getInitial* callbacks to use `getPromptFromStore` with stable deps
4. Line 183: Updated useEffect deps to use specific IDs instead of objects/arrays
5. Removed unused imports: `useCurrentSchemas`, `useCurrentPrompts`
6. Consolidated duplicate loadPrompts useEffect

## Testing

### Test Case 1: Prompt Editing
**Before:** Typing in prompt textarea causes text to reset
**After:** Can type freely without interruption

**Steps:**
1. Open EvaluationModal
2. Click in transcription prompt textarea
3. Type some text
4. **Expected:** Text stays and cursor position is maintained
5. Switch to evaluation tab
6. Type in evaluation prompt textarea
7. **Expected:** Text stays and cursor position is maintained

### Test Case 2: Tab Switching
**Before:** Cannot switch to evaluation tab (state keeps resetting)
**After:** Tab switching works smoothly

**Steps:**
1. Open EvaluationModal (starts on transcription tab)
2. Click "Evaluation" tab button
3. **Expected:** Tab switches to evaluation tab immediately
4. Click "Transcription" tab button
5. **Expected:** Tab switches back without issues

### Test Case 3: Schema Selection
**Before:** Selecting schema might reset prompts
**After:** Schema selection is independent of prompt state

**Steps:**
1. Open EvaluationModal
2. Type custom text in transcription prompt
3. Change transcription schema
4. **Expected:** Custom prompt text is preserved
5. Switch to evaluation tab
6. **Expected:** Tab switch works and transcription prompt is still preserved

## Pattern Summary

This is the **fourth instance** of this destructuring anti-pattern fixed during storage consolidation:

1. **Fix 1:** `useCurrentAppData.ts` - Fixed destructured methods causing infinite loops
2. **Fix 2:** `useAIEvaluation.ts` - Fixed taskQueue destructuring
3. **Fix 3:** `useStructuredExtraction.ts` - Fixed llm config destructuring for API key
4. **Fix 4 (this):** `EvaluationModal.tsx` - Fixed llm destructuring and array deps

### The Anti-Pattern
```typescript
// ❌ NEVER do this with Zustand stores
const { method, config } = useStore();
useEffect(() => {
  // Uses method or config
}, [method, config]); // Unstable refs → infinite loop
```

### The Correct Pattern
```typescript
// ✅ ALWAYS use selectors
const method = useStore((state) => state.method);
const config = useStore((state) => state.config);
useEffect(() => {
  // Uses method or config  
}, [method, config]); // Stable refs → no infinite loop
```

## Commit
- `4a96778` - fix: prevent infinite loop in EvaluationModal causing prompt edit and tab switch issues

## Impact
- **Voice-RX:** EvaluationModal now fully functional for prompt editing and tab navigation
- **Kaira:** Same modal used in Kaira (if applicable) also fixed
- **UX:** No more "fighting" with the UI when trying to edit prompts
- **Stability:** One less source of unexpected re-renders and state resets
- **Build:** All builds pass, no TypeScript errors
