# Voice Rx Listing Evaluation Flow Remediation Plan

_Last updated: 2026-02-06_

## Objective

Stabilize and simplify the **Voice Rx listing view evaluation flow** (3-step overlay in Listing page), while preserving existing strengths (variables + schema system), removing confusing side effects, and improving implementation safety.

This plan explicitly does **not** cover the separate **Evaluators** flow.

---

## Key Problems to Address

1. Selecting **"Derive from Structured Output"** in Step 2/3 currently auto-saves a new schema entry (unexpected global persistence).
2. Schema dropdown semantics are overloaded (selection UI triggering create/save behavior).
3. No "use once" transient schema path exists for experimentation.
4. Repeated derive actions create history clutter and near-duplicates.
5. Step 1 prerequisites can diverge from runtime behavior (user trust gap).
6. Validation is too permissive in some API-flow schema-required scenarios (late failures).
7. Step messaging and variable guidance can be flow-misaligned (upload vs api mental model confusion).

---

## Intended UX End State

```text
Schema Input Surface
├─ Select existing schema (pure selection)
├─ Actions
│  ├─ Derive from Structured Output
│  ├─ Generate with AI
│  └─ Build Visually
└─ Post-action choice
   ├─ Use for this run only (default)
   └─ Save to Library (explicit)
```

Behavior contract:

- **No hidden persistence**.
- **Save is explicit**.
- **Wizard settings are honored at runtime**.
- **Run button blocks known invalid setups before execution**.

---

## Delivery Strategy (3 Phases)

Each phase is independently shippable and testable.

---

## Phase 1 — Decouple Selection vs Creation + Introduce Transient Schema

### Goals

- Remove surprise schema history creation from derive action.
- Establish a clear and safe "use once" workflow.

### Implementation Steps

1. **Make schema selector a pure selector**
   - Remove action-like option from dropdown semantics in evaluation flow usage.
   - Keep dropdown for existing schema IDs only.

2. **Move derive to explicit action control**
   - In Step 2 and Step 3, expose separate action button(s):
     - `Derive from Structured Output`
     - `Generate`
     - `Build Visually`
   - Action should not write to persistent store.

3. **Add transient schema state in overlay**
   - Track ephemeral schema values per step, for current modal session only.
   - Prioritize selected persisted schema if explicitly chosen; otherwise use transient.

4. **Add explicit save path for transient schema**
   - Show `Save to Library` CTA when transient schema exists.
   - Request schema name + optional description before save.
   - Save via store/repository only when user confirms.

5. **Toast and inline state clarity**
   - Example statuses:
     - "Derived schema applied for this run"
     - "Schema saved to library"

### Primary Files

- `src/features/evals/components/EvaluationOverlay.tsx`
- `src/features/settings/components/SchemaSelector.tsx`
- Optional new component:
  - `src/features/evals/components/TransientSchemaActions.tsx`

### Code-level Direction

Use explicit local state for temporary schema:

```ts
// sketch only
const [transientTranscriptionSchema, setTransientTranscriptionSchema] =
  useState<Record<string, unknown> | null>(null);
const [transientEvaluationSchema, setTransientEvaluationSchema] =
  useState<Record<string, unknown> | null>(null);
```

When building config for run:

```ts
// sketch only
const effectiveTranscriptionSchema =
  selectedTranscriptionSchema?.schema ??
  transientTranscriptionSchema ??
  undefined;
const effectiveEvaluationSchema =
  selectedEvaluationSchema?.schema ?? transientEvaluationSchema ?? undefined;
```

### Acceptance Criteria

- Selecting derive no longer creates schema history records.
- User can run evaluation with transient schema only.
- Schema history updates only after explicit save action.

### Commit Boundary

- **Commit A:** UI decoupling + transient schema plumbing.
- **Commit B:** explicit save-to-library UX + final polish.

---

## Phase 2 — Runtime Correctness + Validation + Flow Clarity

### Goals

- Ensure wizard choices map 1:1 to execution behavior.
- Prevent avoidable runtime failures with pre-run checks.

### Implementation Steps

1. **Honor Step 1 prerequisites in evaluation runtime**
   - Pipe prerequisite values from overlay into `useAIEvaluation` execution.
   - Ensure script/language/preserve-code-switching decisions are used in prompt context and normalization decisions.

2. **Strengthen API-flow schema gating**
   - If API path requires call-1 schema, block run when absent.
   - Provide actionable inline issue text.

3. **Unify validation and disable logic**
   - `canRun` should align with runtime hard requirements.
   - Sidebar “Issues” should match run blocker logic exactly.

4. **Improve flow-specific helper content**
   - Upload and API mode should show context-aware copy for Step 2/Step 3.
   - Avoid showing segment/time-window messaging in API mode unless relevant.

5. **Variable guidance improvements**
   - Keep chips/selectors but sharpen reasons:
     - "Available after Step 2"
     - "API flow only"
     - "Requires segmented transcript"

### Primary Files

- `src/features/evals/components/EvaluationOverlay.tsx`
- `src/features/evals/hooks/useAIEvaluation.ts`
- `src/services/templates/variableResolver.ts`
- `src/components/ui/VariablePickerPopover.tsx`
- `src/services/templates/variableRegistry.ts` (copy/reason tuning)

### Code-level Direction

Use a single preflight validator function shared by UI and runtime entry:

```ts
// sketch only
function validateEvaluationConfig(
  flowType,
  config,
  listing,
): ValidationIssue[] {
  // return canonical issues consumed by canRun + sidebar + runtime guard
}
```

### Acceptance Criteria

- Step 1 settings demonstrably affect execution behavior.
- Known missing schema prerequisites are blocked before run.
- UI issue list and runtime validation are consistent.

### Commit Boundary

- **Commit C:** prerequisites-to-runtime mapping + shared validation.
- **Commit D:** flow-specific UX copy and variable reason polish.

---

## Phase 3 — Library Hygiene, Dedup, and Operational Hardening

### Goals

- Keep schema library clean over time.
- Ensure safe and reviewable implementation workflow.

### Implementation Steps

1. **Add schema dedup/fingerprint on save**
   - Canonicalize schema JSON and hash.
   - Before create, detect same `promptType + fingerprint`.
   - Reuse existing schema (or prompt user) instead of creating duplicate.

2. **Add schema provenance metadata**
   - Track source context where practical:
     - `manual`
     - `derived_from_structured_output`
     - `ai_generated`
   - Optionally include listing ID / timestamp in description metadata.

3. **Preserve user naming intent**
   - If user provides name, preserve it.
   - Keep version semantics stable, but avoid forcing generic renames for explicit names.

4. **Telemetry/logging for key transitions**
   - Log derive action (transient apply).
   - Log explicit save action and dedup decisions.

### Primary Files

- `src/services/storage/schemasRepository.ts`
- `src/stores/schemasStore.ts`
- `src/types/schema.types.ts` (if metadata fields added)
- `src/features/settings/components/SchemasTab.tsx` (display provenance badge, optional)

### Code-level Direction

Fingerprint helper concept:

```ts
// sketch only
function schemaFingerprint(schema: Record<string, unknown>): string {
  const canonical = stableStringify(schema);
  return sha256(canonical);
}
```

### Acceptance Criteria

- Saving equivalent derived schema repeatedly does not spam history.
- Saved schemas can indicate provenance/source.
- Naming behavior is predictable and user-controlled.

### Commit Boundary

- **Commit E:** dedup + fingerprint support.
- **Commit F:** provenance + UI metadata surfacing (optional split).

---

## Git-Safe Execution Workflow (Worktree-First)

## Why

- Keeps main workspace stable.
- Makes rollback/cherry-pick clean.
- Supports iterative commit + re-test loop safely.

## Recommended Commands

```bash
# from repo root
git fetch origin
git worktree add ../ai-evals-platform-eval-flow-fix -b feat/voice-rx-eval-flow-fix origin/main
```

Inside worktree:

```bash
npm install
npm run lint
npx tsc -b
```

Commit cadence:

```text
Commit A/B (Phase 1)
Commit C/D (Phase 2)
Commit E/F (Phase 3)
```

## Fallback-safe rule

- After each commit:
  1. run lint + typecheck + Playwright smoke
  2. if failures occur, create a **new follow-up commit** (do not amend)
  3. keep each fix atomic and explain impact in commit message

---

## Playwright/Webapp Testing Instructions

Use the **webapp-testing** skill for browser verification and regression checks.

### Skill usage expectation

- Drive local app in browser.
- Verify interaction-level behavior and visible UX states.
- Capture screenshots/logs for each phase.

### Local start

```bash
npm run dev
```

### Critical test scenarios

#### Phase 1 Scenarios

1. Open listing in Voice Rx flow with API response available.
2. Open Evaluation overlay.
3. Step 2 → Derive schema.
4. Confirm:
   - schema is applied to run context
   - **no new history item appears** in schema library unless explicit save is clicked
5. Repeat Step 3 derive; same expectation.

#### Phase 2 Scenarios

1. Change prerequisites (language/script/normalization).
2. Run evaluation and confirm output/runtime aligns with selected settings.
3. Intentionally remove required schema in API flow and confirm pre-run blocker appears.

#### Phase 3 Scenarios

1. Save same derived schema twice.
2. Confirm dedup behavior (reuse / no duplicate entry).
3. Confirm provenance labeling where added.

### Suggested Playwright checklist table

| Area          | Expected                                         |
| ------------- | ------------------------------------------------ |
| Derive action | Applies transient schema only                    |
| Save action   | Persists schema only on explicit click           |
| Run gating    | Blocks invalid API config before execution       |
| Prerequisites | Runtime behavior reflects wizard settings        |
| Dedup         | Repeated equivalent saves do not clutter history |

---

## Definition of Done

1. No hidden schema persistence from derive.
2. Explicit save contract is clear and functional.
3. UI validation and runtime validation are aligned.
4. Prerequisites are honored in execution.
5. Dedup/provenance reduces schema library confusion.
6. Lint/typecheck pass.
7. Playwright verification completed with evidence.

---

## Suggested Commit Messages

- `refactor(eval-overlay): separate schema derive from schema selection`
- `feat(eval-overlay): add transient schema use-once and explicit save flow`
- `fix(eval-runtime): align prerequisites and preflight validation with execution`
- `feat(schemas): add schema dedup fingerprinting and provenance metadata`

---

## Handoff Note

After implementing in worktree and validating:

1. Share branch and commit list.
2. Share Playwright verification notes/screenshots.
3. User validates manually.
4. Merge back to main after approval.
