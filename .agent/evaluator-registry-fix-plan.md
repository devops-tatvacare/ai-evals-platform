# Evaluator Registry Fix Plan

**Date:** 2026-02-10  
**Status:** ✅ IMPLEMENTED  
**Implementation Date:** 2026-02-10 16:09

---

## Problem Summary

### Current Behavior
When a user clicks "Fork" on an evaluator in the registry overlay:
1. ✅ The evaluator is correctly added to the current listing's evaluator tab
2. ❌ The evaluator **disappears** from the registry overlay
3. ❌ A message appears saying "All registry evaluators are already in this listing"

### Desired Behavior
The registry should act as a **permanent catalog**:
- Registry items should **never be removed** after forking
- Users should be able to fork the same evaluator **multiple times** to the same or different listings
- The registry should remain fully populated regardless of what's been added

---

## Root Cause Analysis

### Location of the Problem
**File:** `/src/features/evals/components/EvaluatorRegistryPicker.tsx`  
**Lines:** 50-65

### The Problematic Logic

```typescript
// Lines 50-56: Build a set of already-forked evaluator IDs
const existingForkedFromIds = new Set(
  evaluators
    .filter(e => e.listingId === listing.id)
    .map(e => e.forkedFrom)
    .filter(Boolean)
);

// Lines 58-65: Filter OUT evaluators that have already been forked
const availableRegistry = registry.filter(e => 
  // ❌ PROBLEM: This line removes registry items that have been forked
  !existingForkedFromIds.has(e.id) &&
  // Not owned by this listing (can't fork your own)
  e.listingId !== listing.id &&
  // Search filter
  (search === '' || e.name.toLowerCase().includes(search.toLowerCase()))
);
```

### Why This is Wrong

The current logic:
1. Creates a Set (`existingForkedFromIds`) containing all evaluator IDs that have already been forked to the current listing
2. Filters the registry to **exclude** any evaluator whose ID is in that Set
3. This causes registry items to disappear after being forked

This implementation treats the registry as a "one-time use inventory" rather than a permanent catalog.

---

## Impact Analysis

### What Works
- ✅ Forking functionality itself (creating the copy)
- ✅ Search filtering
- ✅ Preventing users from forking their own evaluators (listingId check)
- ✅ Registry loading and display
- ✅ Store state management

### What Breaks
- ❌ Registry items disappear after one fork
- ❌ Cannot fork the same evaluator multiple times
- ❌ Confusing message: "All registry evaluators are already in this listing"
- ❌ Registry becomes unusable after forking all items once

---

## Proposed Solution

### Option 1: Complete Removal of Fork-Check (RECOMMENDED)

**Approach:** Remove the `existingForkedFromIds` filtering entirely, allowing users to fork any registry item as many times as they want.

**Changes Required:**

1. **File:** `/src/features/evals/components/EvaluatorRegistryPicker.tsx`
   - **Lines 50-56:** DELETE the `existingForkedFromIds` Set creation
   - **Line 60:** REMOVE the `!existingForkedFromIds.has(e.id) &&` check
   - **Line 140:** UPDATE the empty state message

**Modified Code:**
```typescript
// Lines 58-65 (simplified)
const availableRegistry = registry.filter(e => 
  // Not owned by this listing (can't fork your own)
  e.listingId !== listing.id &&
  // Search filter
  (search === '' || e.name.toLowerCase().includes(search.toLowerCase()))
);

// Line 140 updated message
: 'No evaluators in registry yet. Create global evaluators to populate the registry.'
```

**Pros:**
- ✅ Simple, surgical fix
- ✅ Aligns with user's expectation of a permanent catalog
- ✅ Allows maximum flexibility (fork same evaluator multiple times)
- ✅ No complex state management needed

**Cons:**
- User could accidentally fork the same evaluator multiple times (but this is intentional based on requirements)

---

### Option 2: Visual Indicator Instead of Filtering (ALTERNATIVE)

**Approach:** Show all registry items but visually indicate which ones have already been forked.

**Changes Required:**

1. **File:** `/src/features/evals/components/EvaluatorRegistryPicker.tsx`
   - **Line 60:** REMOVE the filtering check but KEEP the Set for reference
   - **Lines 146-179:** ADD visual indicators (badge, opacity, etc.) to show already-forked items
   - Button states could change (e.g., "Fork Again" vs "Fork")

**Modified Code Example:**
```typescript
// Keep the Set for reference
const existingForkedFromIds = new Set(
  evaluators
    .filter(e => e.listingId === listing.id)
    .map(e => e.forkedFrom)
    .filter(Boolean)
);

// Don't filter, just show all
const availableRegistry = registry.filter(e => 
  e.listingId !== listing.id &&
  (search === '' || e.name.toLowerCase().includes(search.toLowerCase()))
);

// In the render (line 147+)
{availableRegistry.map(evaluator => {
  const alreadyForked = existingForkedFromIds.has(evaluator.id);
  return (
    <div key={evaluator.id} className={alreadyForked ? 'opacity-60' : ''}>
      {/* Show badge if already forked */}
      {alreadyForked && <span className="badge">Already in listing</span>}
      {/* ... rest of card */}
      <Button>
        {alreadyForked ? 'Fork Again' : 'Fork'}
      </Button>
    </div>
  );
})}
```

**Pros:**
- ✅ Provides visual feedback about what's already been forked
- ✅ Prevents accidental duplicate forks (user is aware)
- ✅ Registry remains fully populated

**Cons:**
- ❌ More complex implementation
- ❌ Requires UI changes (badges, button text, styling)
- ❌ May not be necessary if duplicates are acceptable

---

## Recommendation

**I recommend Option 1** (Complete Removal of Fork-Check) because:

1. **Matches User Intent:** You explicitly stated the registry should "serve as a single source that I can use to refill as many times as possible"
2. **Surgical Fix:** Only 3 lines of code need to be changed/removed
3. **No Complexity:** Doesn't add UI clutter or complex state tracking
4. **Maximum Flexibility:** Users can fork anything as many times as needed

---

## Implementation Steps (Option 1)

### Step 1: Modify `EvaluatorRegistryPicker.tsx`

**Change 1:** Remove the `existingForkedFromIds` logic
```typescript
// DELETE lines 50-56
const existingForkedFromIds = new Set(
  evaluators
    .filter(e => e.listingId === listing.id)
    .map(e => e.forkedFrom)
    .filter(Boolean)
);
```

**Change 2:** Simplify the `availableRegistry` filter
```typescript
// REPLACE lines 58-65 with:
const availableRegistry = registry.filter(e => 
  // Not owned by this listing (can't fork your own)
  e.listingId !== listing.id &&
  // Search filter
  (search === '' || e.name.toLowerCase().includes(search.toLowerCase()))
);
```

**Change 3:** Update the empty state message
```typescript
// UPDATE line 140 to remove the "already in listing" message
: 'No evaluators in registry yet. Create global evaluators to populate the registry.'
```

### Step 2: Testing Checklist

After implementation, verify:

- [ ] Registry shows all global evaluators (except those owned by current listing)
- [ ] Clicking "Fork" adds evaluator to current listing
- [ ] Registry overlay still shows the forked evaluator after forking
- [ ] Can fork the same evaluator multiple times to the same listing
- [ ] Can fork the same evaluator to different listings
- [ ] Search still works correctly
- [ ] Empty state messages are appropriate
- [ ] Can't fork your own evaluators (listingId check still works)

---

## Risk Assessment

**Low Risk** - This is a presentation layer change only:
- ✅ No database schema changes
- ✅ No API changes
- ✅ No store/state management changes
- ✅ Only UI filtering logic is modified
- ✅ Forking functionality itself is unchanged

---

## Rollback Plan

If issues arise, simply revert the changes to `EvaluatorRegistryPicker.tsx`:
- Re-add the `existingForkedFromIds` Set
- Re-add the filtering check
- Restore original empty state message

---

## Alternative Considerations

### Should we prevent duplicate forks?

**Current Recommendation: NO** - Based on your requirement that the registry should be a "single source to refill as many times as possible."

However, if you later decide duplicates are unwanted, we could:
- Add duplicate detection at the **fork action** level (when clicking Fork button)
- Show a confirmation dialog: "You already have a fork of this evaluator. Create another?"
- This would still keep the registry fully populated while preventing accidental duplicates

---

## Questions for Review

Before implementing, please confirm:

1. **Is Option 1 (complete removal) acceptable?** Or would you prefer Option 2 with visual indicators?
2. **Should there be any limits on forks?** (e.g., max 10 forks of the same evaluator?)
3. **Should we show any visual feedback** that an evaluator has been forked before? (Even without filtering it out?)
4. **Empty state message:** Is the proposed message suitable, or would you like different wording?

---

## Implementation Summary

### Changes Made ✅

**File:** `/src/features/evals/components/EvaluatorRegistryPicker.tsx`

1. **Removed Fork Status Filtering** (Lines 48-56)
   - ✅ Deleted the `existingForkedFromIds` Set creation
   - ✅ Removed the filter check that was hiding already-forked items
   - ✅ Registry now shows all global evaluators (except those owned by current listing)

2. **Added Delete Functionality**
   - ✅ Imported `Trash2` icon from lucide-react
   - ✅ Added `deleting` state to track deletion in progress
   - ✅ Added `deleteEvaluator` from store dependency
   - ✅ Created `handleDelete` function with confirmation dialog
   - ✅ Added delete button (trash icon) next to fork button
   - ✅ Styled delete button in danger/red color scheme
   - ✅ Proper disabled states (can't delete while forking, can't fork while deleting)

3. **Updated Empty State Message**
   - ✅ Simplified message to remove "already in this listing" case
   - ✅ New message: "Create global evaluators to populate the registry"

4. **UI Layout Enhancement**
   - ✅ Wrapped Fork and Delete buttons in flex container
   - ✅ Delete button uses ghost variant for subtlety
   - ✅ Delete button shows only when hovering (due to ghost styling)

### How Delete Works

- **Deletes only the registry item** (the source evaluator with `isGlobal: true`)
- **Does NOT affect forked copies** because:
  - Each fork has a unique ID (generated during fork)
  - Delete operates by ID only
  - Forked copies are independent with different IDs
- **Confirmation dialog** prevents accidental deletions
- **User-friendly message** clarifies that forks won't be affected

### Testing Verification Needed

Please verify:
- [ ] Registry shows all global evaluators when opened
- [ ] Forking an evaluator keeps it visible in the registry
- [ ] Can fork the same evaluator multiple times
- [ ] Delete button appears on each registry item
- [ ] Clicking delete shows confirmation dialog
- [ ] After confirming deletion, item is removed from registry
- [ ] Forked copies in listings remain intact after deletion
- [ ] Can't delete while a fork is in progress
- [ ] Can't fork while a deletion is in progress

---

## Next Steps

1. ✅ Review and approve this plan → **COMPLETED**
2. ✅ Implement changes per approved plan → **COMPLETED**
3. ⏳ **YOU ARE HERE:** Test all scenarios from testing checklist above
4. ⏳ Test all scenarios from testing checklist
5. ⏳ Deploy and verify in real usage

**DO NOT PROCEED TO IMPLEMENTATION WITHOUT APPROVAL**
