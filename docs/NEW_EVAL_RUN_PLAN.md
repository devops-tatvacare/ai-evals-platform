# New Eval Run — Implementation Plan

## Overview

Add a "New Eval" workflow to the kaira-evals UI. A split dropdown button (matching the `SplitButton` component used in voice-rx evaluators) offers two distinct wizard overlay flows:

- **Batch Evaluation** — Upload CSV, select threads, toggle evaluators, configure LLM, submit
- **Adversarial Stress Test** — Configure Kaira API, set test params, configure LLM, submit

After submission, redirect to RunDetail page with live progress polling and clear status messaging.

---

## Entry Point

**Location:** Dashboard page (`src/features/evalRuns/pages/Dashboard.tsx`) header area + Runs list page (`src/features/evalRuns/pages/RunList.tsx`) header area.

**Component:** Reuse existing `SplitButton` from `src/components/ui/SplitButton.tsx`.

- Primary action: "Batch Evaluation" (most common flow)
- Dropdown items:
  1. **Batch Evaluation** — icon: `FileSpreadsheet`, description: "Evaluate conversation threads from CSV data"
  2. **Adversarial Stress Test** — icon: `ShieldAlert`, description: "Run adversarial inputs against live Kaira API"

Clicking either option opens the corresponding wizard overlay.

---

## Wizard Flows

### Batch Evaluation Wizard (6 steps)

| Step | Title | Content |
|------|-------|---------|
| 1 | **Run Info** | Name (text input, required), Description (textarea, optional) |
| 2 | **Data Source** | CSV file upload via drag-drop or file picker. On upload: call preview endpoint, show summary card (thread count, message count, user count, date range). Validation: must be valid CSV with required columns. |
| 3 | **Thread Scope** | Radio group: "All threads" / "Random sample" / "Specific threads". "Random sample" reveals a number input for sample size. "Specific threads" reveals a searchable multi-select populated from preview endpoint thread IDs. |
| 4 | **Evaluators** | Three toggle switches: Intent Evaluation (on), Correctness Evaluation (on), Efficiency Evaluation (on). At least one must remain on — disable the last active toggle. Optional: Intent system prompt textarea (collapsed by default, expandable). |
| 5 | **LLM Config** | Provider dropdown (Gemini / OpenAI), Model dropdown (populated per provider), Temperature slider (0.0–2.0, default 0.1). All values pre-filled from settings store. Read-only display of which API key will be used (masked, e.g., "sk-...7f2a"). Link to settings page if no key configured. |
| 6 | **Review** | Summary of all selections. Run name, data file name, thread count, evaluators enabled, LLM provider/model/temp. "Start Evaluation" button. |

### Adversarial Stress Test Wizard (5 steps)

| Step | Title | Content |
|------|-------|---------|
| 1 | **Run Info** | Name (text input, required), Description (textarea, optional) |
| 2 | **Kaira API Config** | User ID (pre-filled with default `c22a5505-f514-11f0-9722-000d3a3e18d5`), Kaira API URL (text input), Auth Token (password input). Connection test button — hits a lightweight Kaira endpoint to validate credentials. |
| 3 | **Test Config** | Test case count (number input, default 15, range 5–50). Category distribution info (auto-distributed across 7 categories). Difficulty distribution info (auto-distributed across easy/medium/hard). Turn delay slider (0.5–5.0s, default 1.5s), Case delay slider (1.0–10.0s, default 3.0s). |
| 4 | **LLM Config** | Same as batch step 5 — shared component. |
| 5 | **Review** | Summary of all selections. "Start Stress Test" button. |

### Wizard Shell (shared)

Follows the pattern from `EvaluationOverlay.tsx`:

- Full-screen overlay with fixed backdrop
- Header: title + close button (X) + step indicator pills
- Body: scrollable content area for current step
- Footer: Back / Next buttons, step N of M indicator
- Close confirmation if form has unsaved state
- Escape key closes (with confirmation if dirty)

---

## Phase 1: Backend Foundations

### 1.1 — Add `name` and `description` columns to `EvalRun` model

**File:** `backend/app/models/eval_run.py`

Add two nullable string columns to the `EvalRun` class:
- `name: Mapped[str | None]` — user-provided run label
- `description: Mapped[str | None]` — user-provided description

Since the project has no Alembic migrations set up, these columns should be added with `nullable=True` and the table recreated via `docker compose down -v && docker compose up --build` (consistent with current dev workflow of wiping the volume).

### 1.2 — Update EvalRun schemas

**File:** `backend/app/schemas/` (new or existing eval run schemas)

Add `name` and `description` to the response schema and any create/update schemas used by the eval runs API. Ensure camelCase serialization via the existing `CamelORMModel` base.

### 1.3 — CSV Preview endpoint

**New endpoint:** `POST /api/eval-runs/preview`

Accepts multipart file upload (CSV). Parses with `DataLoader`, returns:

```
{
  "totalMessages": 1842,
  "totalThreads": 156,
  "totalUsers": 23,
  "dateRange": { "start": "2025-12-01T...", "end": "2026-01-15T..." },
  "threadIds": ["tid-001", "tid-002", ...],
  "intentDistribution": { "log_meal": 980, "ask_question": 412, ... },
  "messagesWithErrors": 12,
  "messagesWithImages": 45
}
```

This endpoint does NOT persist anything — it's a stateless preview. The CSV content is parsed in-memory. Uses `DataLoader` directly with `csv_content` param, calls `get_statistics()` and `get_all_thread_ids()`.

Add date range extraction to `DataLoader.get_statistics()` (currently missing — needs min/max of `timestamp` across all messages).

**File:** `backend/app/routes/eval_runs.py` — add to existing router.

### 1.4 — Settings-based API key resolution for job worker

Currently `run_batch_evaluation()` takes `api_key` as a direct parameter. Change this so the job worker reads the API key from the `settings` table at execution time.

**Approach:**
- Add a helper function `get_llm_settings_from_db()` in `backend/app/services/evaluators/batch_runner.py` (or a shared utils module) that queries the `settings` table for the voice-rx settings (key: `voice-rx-settings`) and extracts `llm.apiKey`, `llm.provider`, `llm.selectedModel`.
- The job params will contain `llm_provider` and `llm_model` and `temperature` (user selections from the wizard) but NOT the API key.
- The worker reads the API key from settings at runtime.
- If no API key is found in settings, the job fails immediately with a clear error: "No API key configured. Go to Settings to add your {provider} API key."

**Impact on `run_batch_evaluation()` signature:** The `api_key` param becomes optional — if not provided, read from settings. This preserves backward compatibility with any direct API calls that do pass a key.

### 1.5 — Adversarial job handler

**File:** `backend/app/services/job_worker.py`

Register a new handler: `@register_job_handler("evaluate-adversarial")`

This handler:
1. Reads job params: `user_id`, `kaira_api_url`, `kaira_auth_token`, `test_count`, `turn_delay`, `case_delay`, `llm_provider`, `llm_model`, `temperature`, `name`, `description`
2. Reads API key from settings (same as batch)
3. Creates LLM provider with `LoggingLLMWrapper`
4. Creates `EvalRun` record with `command="adversarial"`, `name`, `description`
5. Instantiates `AdversarialEvaluator` and calls `run_live_stress_test()`
6. Persists each `AdversarialEvaluation` result to the `adversarial_evaluations` table (currently the adversarial evaluator returns results in memory — the handler needs to save them, similar to how `run_batch_evaluation` saves `ThreadEvaluation` rows)
7. Updates `EvalRun` with summary and status

**New file:** `backend/app/services/evaluators/adversarial_runner.py` — extract the orchestration logic into a `run_adversarial_evaluation()` function (parallel to `run_batch_evaluation()`), keeping the handler in `job_worker.py` thin.

### 1.6 — Update job submission to carry `name` and `description`

The `POST /api/jobs` endpoint already accepts arbitrary `params` (JSONB). The `name` and `description` will be passed inside `params` and extracted by the job handlers when creating the `EvalRun` record. No changes needed to the jobs API itself.

### Phase 1 Deliverables

- `EvalRun` model gains `name`, `description` columns
- `POST /api/eval-runs/preview` endpoint working
- Job worker reads API keys from settings table
- `evaluate-adversarial` job handler registered and functional
- `adversarial_runner.py` orchestration module
- Updated schemas for eval run responses

---

## Phase 2: Frontend Wizard Overlays

### 2.1 — Shared wizard infrastructure

**New files in `src/features/evalRuns/components/`:**

**`WizardOverlay.tsx`** — The shared overlay shell. Props:
- `title: string`
- `steps: { key: string; label: string }[]`
- `currentStep: string`
- `onClose: () => void`
- `onBack: () => void`
- `onNext: () => void`
- `canGoNext: boolean`
- `isLastStep: boolean`
- `onSubmit: () => void`
- `isSubmitting: boolean`
- `children: ReactNode` (step content)

Renders: backdrop, header with step pills (matching `EvaluationOverlay` tab style), scrollable body, footer with Back/Next/Submit buttons. Handles escape key, close confirmation.

**`LLMConfigStep.tsx`** — Shared LLM configuration step used by both wizards. Reads from `useSettingsStore` to pre-fill provider, model, API key. Displays masked key. Shows warning + link to settings if no key found. Lets user override provider/model/temperature for this run without changing global settings.

**`ReviewStep.tsx`** — Shared review step that receives a `sections: { label: string; items: { key: string; value: string }[] }[]` prop and renders a summary card layout.

**`RunInfoStep.tsx`** — Shared first step with name (required) and description (optional) fields.

### 2.2 — Batch Evaluation wizard

**New files:**

**`NewBatchEvalOverlay.tsx`** — Main component. Manages wizard state:
- `runName`, `runDescription`
- `uploadedFile: File | null`, `previewData: PreviewResponse | null`
- `threadScope: 'all' | 'sample' | 'specific'`, `sampleSize: number`, `selectedThreadIds: string[]`
- `evaluators: { intent: boolean; correctness: boolean; efficiency: boolean }`
- `intentSystemPrompt: string`
- `llmConfig: { provider: string; model: string; temperature: number }`

Step rendering uses conditional content based on `currentStep`.

**`CsvUploadStep.tsx`** — Drag-and-drop zone + file input. On file select: reads file, calls `POST /api/eval-runs/preview` with the file, displays the returned stats in a summary card. Shows loading spinner during upload/parse. Shows validation errors if CSV is malformed or missing required columns.

**`ThreadScopeStep.tsx`** — Radio group for scope selection. Conditionally renders sample size input or thread multi-select. Thread list comes from the preview response. Searchable list with checkboxes for specific thread selection.

**`EvaluatorToggleStep.tsx`** — Three toggle switches with labels and descriptions. Logic to prevent all-off state (disable the last remaining active toggle). Collapsible "Advanced" section with intent system prompt textarea.

### 2.3 — Adversarial Stress Test wizard

**New files:**

**`NewAdversarialOverlay.tsx`** — Main component. Manages wizard state:
- `runName`, `runDescription`
- `userId`, `kairaApiUrl`, `kairaAuthToken`
- `testCount`, `turnDelay`, `caseDelay`
- `llmConfig: { provider: string; model: string; temperature: number }`

**`KairaApiConfigStep.tsx`** — Form fields for user ID (pre-filled), API URL, auth token. "Test Connection" button that makes a lightweight call to validate. Green checkmark on success, red error on failure.

**`TestConfigStep.tsx`** — Test case count input with range validation. Info display showing category distribution (7 categories) and difficulty distribution (easy/medium/hard). Delay sliders for turn and case delays with labels explaining their purpose.

### 2.4 — API client additions

**File:** `src/services/api/evalRunsApi.ts`

Add:
- `previewCsv(file: File): Promise<PreviewResponse>` — `POST /api/eval-runs/preview` with multipart form data
- Types: `PreviewResponse` interface

**File:** `src/services/api/jobsApi.ts`

No changes needed — `jobsApi.submit()` already handles arbitrary params.

### 2.5 — Entry point integration

**Files:** `src/features/evalRuns/pages/Dashboard.tsx`, `src/features/evalRuns/pages/RunList.tsx`

Add `SplitButton` to both page headers. Wire dropdown items to state flags:
- `showBatchWizard: boolean` — renders `<NewBatchEvalOverlay />`
- `showAdversarialWizard: boolean` — renders `<NewAdversarialOverlay />`

### 2.6 — Submit flow

Both wizards submit via:
1. Call `jobsApi.submit('evaluate-batch' | 'evaluate-adversarial', params)`
2. Receive job response with `job.id`
3. Navigate to `/kaira/runs/{runId}` — but the run ID comes from the job result, not the job ID. Two options:
   - Option A: Poll the job until it creates the `EvalRun` record, then navigate to the run. Problem: adds delay before redirect.
   - Option B: The job response includes the `run_id` in the result. Problem: run isn't created until the handler starts.
   - Option C (recommended): Navigate to a new route `/kaira/jobs/{jobId}` that shows job progress, and once the run is created, auto-redirects to `/kaira/runs/{runId}`. The job's `result` field will contain `run_id` once the handler creates it.

Actually, simplest approach: navigate to `/kaira/runs` with a toast "Evaluation submitted — it will appear here shortly." The runs list auto-refreshes. The user clicks into the run once it appears. Less magical, but reliable and no new routes needed. The run appears within seconds (worker polls every 5s).

Better approach: the job handlers should write `run_id` into the job's `progress` field immediately after creating the `EvalRun` record. Then the submit flow polls the job for a few seconds until `progress.run_id` appears, then navigates to `/kaira/runs/{runId}`. Fallback: if polling times out (>10s), redirect to runs list with a toast.

### Phase 2 Deliverables

- `WizardOverlay` shell component
- 4 shared step components (RunInfo, LLMConfig, Review, CsvUpload)
- `NewBatchEvalOverlay` with 6 steps, fully wired
- `NewAdversarialOverlay` with 5 steps, fully wired
- SplitButton integrated on Dashboard + RunList pages
- CSV preview API client function
- Submit → redirect flow with progress polling

---

## Phase 3: Live Progress & Polish

### 3.1 — RunDetail live progress mode

**File:** `src/features/evalRuns/pages/RunDetail.tsx`

When the page loads a run with `status === "running"`:
- Show a progress section at the top of the page:
  - Status badge: "Running" with a pulsing dot
  - Progress bar (determinate): `progress.current / progress.total`
  - Progress message: `progress.message` (e.g., "Evaluating thread 12/156")
  - Elapsed time counter (computed from `startedAt`)
- Poll `GET /api/jobs/{jobId}` every 2 seconds using `jobsApi.pollUntilDone()`
- On each poll update: refresh the progress bar and message
- On `status === "completed"`: stop polling, re-fetch the full run data, render the normal results view. Show a brief success banner: "Evaluation completed in {duration}s"
- On `status === "failed"`: stop polling, show error state with `errorMessage`. Show retry suggestion.
- On `status === "cancelled"`: stop polling, show cancelled state.

The `EvalRun` needs `job_id` to be accessible from the frontend response so the RunDetail page knows which job to poll. This is already in the model — verify it's in the response schema.

For the run to appear with `status="running"` in the first place, the job handler must create the `EvalRun` record early (which it already does — `batch_runner.py` line 118-127 creates the record before processing threads).

### 3.2 — Adversarial progress specifics

Adversarial runs have a different progress pattern:
- "Generating test cases..." (initial phase)
- "Running test 3/15: quantity_ambiguity — running conversation..."
- "Running test 3/15: quantity_ambiguity — judging transcript..."

The adversarial runner should update job progress with these messages (the `AdversarialEvaluator` already accepts a `progress_callback`). Wire it to `update_job_progress()` in the handler.

### 3.3 — RunDetail display for adversarial results

The RunDetail page already has adversarial result display (fetches via `fetchRunAdversarial(runId)` and renders verdict cards). Verify this works end-to-end with the new adversarial runner. If the existing display is sufficient, no changes needed. If not, enhance to show:
- Category breakdown chart
- Difficulty vs verdict matrix
- Rule compliance summary

### 3.4 — Dashboard empty state update

**File:** `src/features/evalRuns/pages/Dashboard.tsx`

Replace the current empty state text:
> "No runs yet. Run an evaluation with the CLI to see results here."

With something that points to the new SplitButton:
> "No runs yet. Click 'New Eval' above to get started."

### 3.5 — Error handling and edge cases

- **No API key configured:** LLMConfigStep shows a clear warning with a direct link to the settings page. The "Next" button is disabled until a valid key exists in settings.
- **CSV upload failure:** CsvUploadStep shows inline error with the parsing error message. Allows re-upload.
- **Preview endpoint returns 0 threads:** Show warning, disable "Next" on thread scope step.
- **Job submission failure:** Show error toast, keep wizard open so user can retry.
- **Worker not running:** Job stays in "queued" state. RunDetail shows "Queued — waiting for worker to pick up this job..." with no progress bar (indeterminate state).
- **Large CSV (>10MB):** Consider adding a file size warning. The preview endpoint should handle large files without timing out (DataLoader uses pandas which is efficient for this).
- **Adversarial: Kaira API unreachable:** "Test Connection" button shows clear error. Submission still allowed (connection might be intermittent) but with a warning.

### 3.6 — Frontend types

**File:** `src/types/` — add or extend:

- `PreviewResponse` interface (thread IDs, stats, date range)
- Update `Run` type to include `name` and `description` fields
- `EvalWizardState` types for both wizard flows (batch and adversarial)

### Phase 3 Deliverables

- RunDetail page with live polling progress bar for running jobs
- Adversarial runner wired with progress callbacks
- Dashboard empty state updated
- Error handling for all edge cases
- Frontend types updated

---

## File Impact Summary

### New Backend Files
- `backend/app/services/evaluators/adversarial_runner.py`

### Modified Backend Files
- `backend/app/models/eval_run.py` — add `name`, `description` columns
- `backend/app/schemas/` — update eval run schemas
- `backend/app/routes/eval_runs.py` — add preview endpoint
- `backend/app/services/job_worker.py` — add adversarial handler, write `run_id` to progress
- `backend/app/services/evaluators/batch_runner.py` — settings-based API key resolution, write `run_id` to job progress
- `backend/app/services/evaluators/data_loader.py` — add date range to `get_statistics()`

### New Frontend Files (all in `src/features/evalRuns/components/`)
- `WizardOverlay.tsx`
- `RunInfoStep.tsx`
- `CsvUploadStep.tsx`
- `ThreadScopeStep.tsx`
- `EvaluatorToggleStep.tsx`
- `KairaApiConfigStep.tsx`
- `TestConfigStep.tsx`
- `LLMConfigStep.tsx`
- `ReviewStep.tsx`
- `NewBatchEvalOverlay.tsx`
- `NewAdversarialOverlay.tsx`

### Modified Frontend Files
- `src/features/evalRuns/pages/Dashboard.tsx` — SplitButton + overlay triggers + empty state
- `src/features/evalRuns/pages/RunList.tsx` — SplitButton + overlay triggers
- `src/features/evalRuns/pages/RunDetail.tsx` — live progress polling
- `src/services/api/evalRunsApi.ts` — preview endpoint client
- `src/types/` — new types, update Run type

### Not Changed
- No new routes needed in `Router.tsx` (overlays, not pages)
- No sidebar changes
- No changes to existing job API or worker loop structure
- Settings store untouched (read-only access from wizard)
