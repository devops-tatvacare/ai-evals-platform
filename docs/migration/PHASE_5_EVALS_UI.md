# Phase 5: Kaira-Evals Dashboard, Runs & Logs UI

## Overview

Port the kaira-evals standalone UI (Dashboard, Runs, Logs pages) into the ai-evals-platform
under the Kaira Bot app section. This includes:

- 3 new nav items in the Kaira Bot sidebar (Dashboard, Runs, Logs) above existing chat sessions
- 6 new route pages (Dashboard, RunList, RunDetail, ThreadDetail, AdversarialDetail, Logs)
- 12 ported components from kaira-evals
- 1 new API client module (`evalRunsApi.ts`)
- 5 missing backend endpoints
- 1 new dependency (`recharts` for trend charts)

## Prerequisites

- Phase 3 merged to `main` (eval_runs backend routes exist)
- Phase 4 (cleanup) should ideally be done first but is NOT required

## Branch Strategy

```bash
git checkout main
git checkout -b feat/phase-5-evals-ui
# commit after each step: "phase 5.N: description"
# when done: git checkout main && git merge feat/phase-5-evals-ui --no-ff
```

## Reference

All source files being ported live in:
```
~/Programs/python/ai-tatva-evals/kaira-evals/src-ui/src/
```

The target platform is:
```
~/Programs/python/ai-tatva-evals/ai-evals-platform/
```

---

## Step 5.1: Add Missing Backend Endpoints

**Why**: The kaira-evals frontend expects 5 endpoints that Phase 3 did not create.

**File to edit**: `backend/app/routes/eval_runs.py`

**Add these 5 endpoints** to the existing router (`router = APIRouter(prefix="/api/eval-runs")`):

### 5.1.1: DELETE run

```python
@router.delete("/{run_id}")
async def delete_eval_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(EvalRun, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    await db.delete(run)  # CASCADE deletes threads, adversarial, logs
    await db.commit()
    return {"deleted": True, "run_id": run_id}
```

### 5.1.2: Thread history (across runs)

```python
@router.get("/threads/{thread_id}/history")
async def get_thread_history(thread_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ThreadEvaluation)
        .where(ThreadEvaluation.thread_id == thread_id)
        .order_by(desc(ThreadEvaluation.id))
    )
    evals = result.scalars().all()
    return {
        "thread_id": thread_id,
        "history": [_thread_to_dict(e) for e in evals],
        "total": len(evals),
    }
```

**IMPORTANT**: This route uses path `/threads/{thread_id}/history` which conflicts with the
`/api/eval-runs` prefix. You have two options:

**Option A (recommended)**: Add a separate router in `eval_runs.py`:
```python
threads_router = APIRouter(prefix="/api/threads", tags=["threads"])

@threads_router.get("/{thread_id}/history")
async def get_thread_history(...):
    ...
```
Then register it in `backend/app/main.py`:
```python
from app.routes.eval_runs import router as eval_runs_router, threads_router
app.include_router(threads_router)
```

**Option B**: Create a new file `backend/app/routes/threads.py` with its own router.

### 5.1.3: Trends endpoint

```python
@router.get("/trends")
async def get_trends(days: int = Query(30, ge=1, le=365), db: AsyncSession = Depends(get_db)):
    """Aggregate correctness verdicts by day for trend charts."""
    from datetime import datetime, timedelta, timezone
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    result = await db.execute(
        select(
            func.date(ThreadEvaluation.created_at).label("day"),
            ThreadEvaluation.worst_correctness,
            func.count().label("cnt"),
        )
        .where(ThreadEvaluation.created_at >= cutoff)
        .group_by("day", ThreadEvaluation.worst_correctness)
        .order_by("day")
    )
    rows = result.all()
    return {
        "data": [
            {"day": str(r.day), "worst_correctness": r.worst_correctness, "cnt": r.cnt}
            for r in rows
        ],
        "days": days,
    }
```

**Note**: If `ThreadEvaluation` does not have a `created_at` column, you may need to add it.
Check `backend/app/models/eval_run.py` — the `ThreadEvaluation` model should have `created_at`
from the base mixin. If not, you need to join with `EvalRun` to get the date.

### 5.1.4: Global logs listing

```python
@router.get("/logs")
async def list_all_logs(
    run_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    query = select(ApiLog).order_by(desc(ApiLog.id)).limit(limit).offset(offset)
    if run_id:
        query = query.where(ApiLog.run_id == run_id)
    result = await db.execute(query)
    logs = result.scalars().all()
    total_q = select(func.count(ApiLog.id))
    if run_id:
        total_q = total_q.where(ApiLog.run_id == run_id)
    total = (await db.execute(total_q)).scalar() or 0
    return {
        "logs": [_log_to_dict_full(log) for log in logs],
        "total": total,
        "limit": limit,
        "offset": offset,
        "run_id": run_id,
    }
```

**IMPORTANT**: The existing `_log_to_dict` helper is minimal (no prompt/response/error fields).
Add a full version:

```python
def _log_to_dict_full(log: ApiLog) -> dict:
    return {
        "id": log.id, "run_id": log.run_id, "thread_id": log.thread_id,
        "provider": log.provider, "model": log.model, "method": log.method,
        "prompt": log.prompt, "system_prompt": log.system_prompt,
        "response": log.response, "error": log.error,
        "duration_ms": log.duration_ms, "tokens_in": log.tokens_in,
        "tokens_out": log.tokens_out, "created_at": log.created_at.isoformat() if log.created_at else None,
    }
```

Check `backend/app/models/eval_run.py` for the `ApiLog` model — it should have `prompt`,
`system_prompt`, `response`, `error`, `thread_id` columns. If any are missing, add them to the
model and let `create_all()` handle table creation on restart.

### 5.1.5: Delete logs

```python
@router.delete("/logs")
async def delete_logs(
    run_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import delete as sql_delete
    stmt = sql_delete(ApiLog)
    if run_id:
        stmt = stmt.where(ApiLog.run_id == run_id)
    result = await db.execute(stmt)
    await db.commit()
    return {"deleted": result.rowcount, "run_id": run_id}
```

### 5.1.6: Enrich the stats endpoint

The existing `GET /api/eval-runs/stats/summary` is missing distribution data. Update it:

```python
@router.get("/stats/summary")
async def get_summary_stats(db: AsyncSession = Depends(get_db)):
    total_runs = (await db.execute(select(func.count(EvalRun.id)))).scalar() or 0
    total_threads = (await db.execute(
        select(func.count(func.distinct(ThreadEvaluation.thread_id)))
    )).scalar() or 0
    total_adversarial = (await db.execute(
        select(func.count(AdversarialEvaluation.id))
    )).scalar() or 0

    # Correctness distribution
    corr_result = await db.execute(
        select(ThreadEvaluation.worst_correctness, func.count())
        .where(ThreadEvaluation.worst_correctness.isnot(None))
        .group_by(ThreadEvaluation.worst_correctness)
    )
    correctness_distribution = {r[0]: r[1] for r in corr_result.all()}

    # Efficiency distribution
    eff_result = await db.execute(
        select(ThreadEvaluation.efficiency_verdict, func.count())
        .where(ThreadEvaluation.efficiency_verdict.isnot(None))
        .group_by(ThreadEvaluation.efficiency_verdict)
    )
    efficiency_distribution = {r[0]: r[1] for r in eff_result.all()}

    # Adversarial distribution
    adv_result = await db.execute(
        select(AdversarialEvaluation.verdict, func.count())
        .where(AdversarialEvaluation.verdict.isnot(None))
        .group_by(AdversarialEvaluation.verdict)
    )
    adversarial_distribution = {r[0]: r[1] for r in adv_result.all()}

    # Average intent accuracy
    avg_intent = (await db.execute(
        select(func.avg(ThreadEvaluation.intent_accuracy))
        .where(ThreadEvaluation.intent_accuracy.isnot(None))
    )).scalar()

    # Intent distribution (correct vs incorrect — derive from accuracy)
    intent_distribution = {}
    if total_threads > 0:
        correct_count = (await db.execute(
            select(func.count())
            .where(ThreadEvaluation.intent_accuracy >= 0.5)
        )).scalar() or 0
        intent_distribution = {
            "CORRECT": correct_count,
            "INCORRECT": total_threads - correct_count,
        }

    return {
        "total_runs": total_runs,
        "total_threads_evaluated": total_threads,
        "total_adversarial_tests": total_adversarial,
        "correctness_distribution": correctness_distribution,
        "efficiency_distribution": efficiency_distribution,
        "adversarial_distribution": adversarial_distribution,
        "avg_intent_accuracy": float(avg_intent) if avg_intent is not None else None,
        "intent_distribution": intent_distribution,
    }
```

**Test**: Restart the backend (`uvicorn app.main:app --reload`) and verify:
- `GET /api/eval-runs/stats/summary` returns distribution objects
- `GET /api/eval-runs/trends?days=30` returns data array
- `GET /api/eval-runs/logs` returns logs with full prompt/response fields
- `GET /api/threads/{some-thread-id}/history` returns history array

**Commit**: `phase 5.1: add missing backend endpoints for evals UI`

---

## Step 5.2: Install recharts Dependency

**Why**: TrendChart component uses `recharts` for line charts.

```bash
npm install recharts
```

**Commit**: `phase 5.2: add recharts dependency for trend charts`

---

## Step 5.3: Port Types from kaira-evals

**File to create**: `src/types/evalRuns.ts`

Copy the **full** type definitions from `kaira-evals/src-ui/src/types/index.ts`. These types are:

```typescript
// All verdict/status union types
export type CorrectnessVerdict = "PASS" | "SOFT FAIL" | "HARD FAIL" | "CRITICAL" | "NOT APPLICABLE";
export type EfficiencyVerdict = "EFFICIENT" | "ACCEPTABLE" | "FRICTION" | "BROKEN";
export type AdversarialVerdict = "PASS" | "SOFT FAIL" | "HARD FAIL" | "CRITICAL";
export type RunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "INTERRUPTED";
export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type RecoveryQuality = "GOOD" | "PARTIAL" | "FAILED" | "NOT NEEDED";
export type FrictionCause = "USER" | "BOT";

// All interfaces: Run, ThreadEvalRow, ThreadEvalResult, ChatMessage,
// IntentEvaluation, CorrectnessEvaluation, EfficiencyEvaluation,
// FrictionTurn, RuleCompliance, AdversarialEvalRow, AdversarialResult,
// TranscriptTurn, SummaryStats, TrendEntry, ApiLogEntry
```

**Source file to copy from**: `kaira-evals/src-ui/src/types/index.ts` (copy verbatim).

Then re-export from the main types barrel. Edit `src/types/index.ts` and add:
```typescript
export * from './evalRuns';
```

**Commit**: `phase 5.3: port kaira-evals types for eval runs UI`

---

## Step 5.4: Port Config and Utilities

### 5.4.1: Label definitions

**File to create**: `src/config/labelDefinitions.ts`

Copy **verbatim** from `kaira-evals/src-ui/src/config/labelDefinitions.ts`. This file contains:
- All verdict/label definition objects (CORRECTNESS_VERDICTS, EFFICIENCY_VERDICTS, etc.)
- METRIC_DEFINITIONS
- Helper functions: `getLabelDefinition()`, `getMetricDefinition()`, `getVerdictColor()`
- Type: `LabelCategory`

This is a self-contained config file with zero external dependencies. Copy as-is.

### 5.4.2: Formatter utilities

**File to create**: `src/utils/evalFormatters.ts`

Copy from `kaira-evals/src-ui/src/utils/formatters.ts`. Functions:
- `timeAgo(iso)` — relative timestamps
- `formatDuration(seconds)` — human-readable duration
- `pct(value, decimals)` — format percentage
- `formatTimestamp(iso)` — local date+time
- `formatChatTimestamp(iso)` — compact timestamp
- `truncate(str, maxLen)` — string truncation
- `humanize(str)` — snake_case to Title Case
- `normalizeLabel(raw)` — uppercase with spaces

### 5.4.3: Color utilities

**File to create**: `src/utils/evalColors.ts`

Copy from `kaira-evals/src-ui/src/utils/colors.ts`:

```typescript
export {
  getVerdictColor,
  CORRECTNESS_SEVERITY_ORDER as CORRECTNESS_ORDER,
  EFFICIENCY_SEVERITY_ORDER as EFFICIENCY_ORDER,
  INTENT_SEVERITY_ORDER as INTENT_ORDER,
  ADVERSARIAL_CATEGORIES,
} from "@/config/labelDefinitions";

export const CATEGORY_COLORS: Record<string, string> = {
  quantity_ambiguity: "#8b5cf6",
  multi_meal_single_message: "#06b6d4",
  correction_contradiction: "#f97316",
  edit_after_confirmation: "#ec4899",
  future_time_rejection: "#14b8a6",
  contextual_without_context: "#6366f1",
  composite_dish: "#84cc16",
};
```

Update the import path in `evalColors.ts` to use `@/config/labelDefinitions` (not relative).

**Commit**: `phase 5.4: port label definitions, formatters, and color utilities`

---

## Step 5.5: Create Eval Runs API Client

**File to create**: `src/services/api/evalRunsApi.ts`

This wraps the backend endpoints for the evals UI. Use the existing `apiRequest` from `./client`.

```typescript
import { apiRequest } from './client';
import type {
  Run, ThreadEvalRow, AdversarialEvalRow,
  SummaryStats, TrendEntry, ApiLogEntry,
} from '@/types';

// --- Runs ---

interface RunsResponse {
  runs: Run[];  // Note: backend returns array directly, not wrapped
}

export async function fetchRuns(params?: {
  command?: string;
  limit?: number;
  offset?: number;
}): Promise<{ runs: Run[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.command) q.set('command', params.command);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  const qs = q.toString();
  const runs = await apiRequest<Run[]>(`/api/eval-runs${qs ? `?${qs}` : ''}`);
  return { runs, total: runs.length };
}

export async function fetchRun(runId: string): Promise<Run> {
  return apiRequest<Run>(`/api/eval-runs/${runId}`);
}

export async function deleteRun(runId: string): Promise<{ deleted: boolean; run_id: string }> {
  return apiRequest(`/api/eval-runs/${runId}`, { method: 'DELETE' });
}

// --- Thread evaluations ---

export async function fetchRunThreads(runId: string): Promise<{
  run_id: string;
  evaluations: ThreadEvalRow[];
  total: number;
}> {
  return apiRequest(`/api/eval-runs/${runId}/threads`);
}

// --- Adversarial evaluations ---

export async function fetchRunAdversarial(runId: string): Promise<{
  run_id: string;
  evaluations: AdversarialEvalRow[];
  total: number;
}> {
  return apiRequest(`/api/eval-runs/${runId}/adversarial`);
}

// --- Thread history ---

export async function fetchThreadHistory(threadId: string): Promise<{
  thread_id: string;
  history: ThreadEvalRow[];
  total: number;
}> {
  return apiRequest(`/api/threads/${threadId}/history`);
}

// --- Stats & Trends ---

export async function fetchStats(): Promise<SummaryStats> {
  return apiRequest<SummaryStats>('/api/eval-runs/stats/summary');
}

export async function fetchTrends(days = 30): Promise<{ data: TrendEntry[]; days: number }> {
  return apiRequest(`/api/eval-runs/trends?days=${days}`);
}

// --- Logs ---

export async function fetchLogs(params?: {
  run_id?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: ApiLogEntry[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.run_id) q.set('run_id', params.run_id);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  const qs = q.toString();
  return apiRequest(`/api/eval-runs/logs${qs ? `?${qs}` : ''}`);
}

export async function fetchRunLogs(runId: string, limit = 200): Promise<{
  run_id: string;
  logs: ApiLogEntry[];
}> {
  return apiRequest(`/api/eval-runs/${runId}/logs?limit=${limit}`);
}

export async function deleteLogs(runId?: string): Promise<{ deleted: number }> {
  const qs = runId ? `?run_id=${runId}` : '';
  return apiRequest(`/api/eval-runs/logs${qs}`, { method: 'DELETE' });
}
```

**IMPORTANT**: The backend uses prefix `/api/eval-runs` (not `/api/runs`). All frontend calls
must match. The kaira-evals UI used `/api/runs` — we adapt in the API client so the
page components don't need to change.

Also add to the API barrel export. Edit `src/services/api/index.ts` and add:
```typescript
export * from './evalRunsApi';
```

**Commit**: `phase 5.5: create eval runs API client`

---

## Step 5.6: Port Shared Components

Create these files under `src/features/evalRuns/components/`. Each is ported from kaira-evals
with only import path changes.

### Files to create (12 components):

| # | File | Source | Notes |
|---|------|--------|-------|
| 1 | `Tooltip.tsx` | `kaira-evals/.../components/Tooltip.tsx` | Copy verbatim |
| 2 | `VerdictBadge.tsx` | `kaira-evals/.../components/VerdictBadge.tsx` | Update imports to `@/config/labelDefinitions` and `@/utils/evalFormatters` |
| 3 | `LabelBadge.tsx` | `kaira-evals/.../components/LabelBadge.tsx` | Update import of VerdictBadge to local `./VerdictBadge` |
| 4 | `MetricInfo.tsx` | `kaira-evals/.../components/MetricInfo.tsx` | Update imports to `@/config/labelDefinitions`, local `./Tooltip` |
| 5 | `DistributionBar.tsx` | `kaira-evals/.../components/DistributionBar.tsx` | Update imports to `@/config/labelDefinitions`, `@/utils/evalFormatters` |
| 6 | `TrendChart.tsx` | `kaira-evals/.../components/TrendChart.tsx` | Update imports to `@/utils/evalColors`, `@/config/labelDefinitions`, `@/utils/evalFormatters` |
| 7 | `RunCard.tsx` | `kaira-evals/.../components/RunCard.tsx` | Update imports; change `Link to` paths from `/runs/` to `/kaira/runs/` |
| 8 | `EvalSection.tsx` | `kaira-evals/.../components/EvalSection.tsx` | Update VerdictBadge import |
| 9 | `EvalTable.tsx` | `kaira-evals/.../components/EvalTable.tsx` | Update imports; change Link paths from `/threads/` to `/kaira/threads/` |
| 10 | `RuleComplianceGrid.tsx` | `kaira-evals/.../components/RuleComplianceGrid.tsx` | Copy verbatim (only uses local types) |
| 11 | `TranscriptViewer.tsx` | `kaira-evals/.../components/TranscriptViewer.tsx` | Update `formatChatTimestamp` import to `@/utils/evalFormatters` |
| 12 | `index.ts` | New barrel | Export all components |

### Critical import path changes

When porting each component, make these substitutions:

| kaira-evals import | ai-evals-platform import |
|---|---|
| `from "../types"` | `from "@/types"` |
| `from "../config/labelDefinitions"` | `from "@/config/labelDefinitions"` |
| `from "../utils/formatters"` | `from "@/utils/evalFormatters"` |
| `from "../utils/colors"` | `from "@/utils/evalColors"` |
| `from "../api/client"` | `from "@/services/api/evalRunsApi"` |
| `from "./ComponentName"` | `from "./ComponentName"` (keep relative) |

### Critical route path changes

All `<Link to="/runs/...">` must become `<Link to="/kaira/runs/...">`.
All `<Link to="/threads/...">` must become `<Link to="/kaira/threads/...">`.
All `<Link to="/logs...">` must become `<Link to="/kaira/logs...">`.

This applies in: `RunCard.tsx`, `EvalTable.tsx`, `RunDetail page`, `ThreadDetail page`,
`AdversarialDetail page`, `Logs page`.

### Barrel export

Create `src/features/evalRuns/components/index.ts`:
```typescript
export { default as Tooltip } from './Tooltip';
export { default as VerdictBadge } from './VerdictBadge';
export { default as LabelBadge } from './LabelBadge';
export { default as MetricInfo } from './MetricInfo';
export { default as DistributionBar } from './DistributionBar';
export { default as TrendChart } from './TrendChart';
export { default as RunCard } from './RunCard';
export { default as EvalSection, EvalCard, EvalCardHeader, EvalCardBody } from './EvalSection';
export { default as EvalTable } from './EvalTable';
export { default as RuleComplianceGrid } from './RuleComplianceGrid';
export { default as TranscriptViewer, ChatViewer, CompactTranscript } from './TranscriptViewer';
```

**Commit**: `phase 5.6: port kaira-evals shared components`

---

## Step 5.7: Port Dashboard Page

**File to create**: `src/features/evalRuns/pages/Dashboard.tsx`

Copy from `kaira-evals/src-ui/src/pages/Dashboard.tsx` with these changes:

1. **Import substitutions** (see table in Step 5.6)
2. API calls use the new client:
   ```typescript
   import { fetchStats, fetchTrends, fetchRuns } from '@/services/api/evalRunsApi';
   ```
3. Component imports from local barrel:
   ```typescript
   import { RunCard, TrendChart, DistributionBar, MetricInfo } from '../components';
   ```
4. Color imports:
   ```typescript
   import { CORRECTNESS_ORDER, EFFICIENCY_ORDER, INTENT_ORDER } from '@/utils/evalColors';
   ```
5. Remove the CLI-specific error message ("Make sure the API server is running: python -m src.cli serve")
   Replace with: "Failed to load dashboard data. Make sure the backend is running."
6. `RunCard` links already point to `/kaira/runs/...` (handled in Step 5.6)

**Commit**: `phase 5.7: port Dashboard page`

---

## Step 5.8: Port RunList Page

**File to create**: `src/features/evalRuns/pages/RunList.tsx`

Copy from `kaira-evals/src-ui/src/pages/RunList.tsx` with import substitutions.

Changes:
1. Import `fetchRuns, deleteRun` from `@/services/api/evalRunsApi`
2. Import `RunCard` from `../components`
3. The `fetchRuns` response shape is `{ runs: Run[], total: number }` — same as ported client

**Commit**: `phase 5.8: port RunList page`

---

## Step 5.9: Port RunDetail Page

**File to create**: `src/features/evalRuns/pages/RunDetail.tsx`

Copy from `kaira-evals/src-ui/src/pages/RunDetail.tsx` with import substitutions.

This is the **largest page** (~400 lines). Key changes:
1. All API imports from `@/services/api/evalRunsApi`
2. All component imports from `../components`
3. All utility imports from `@/utils/evalFormatters` and `@/utils/evalColors`
4. **Route paths**: Every `<Link to="/runs/...">` → `<Link to="/kaira/runs/...">`
5. Every `<Link to="/threads/...">` → `<Link to="/kaira/threads/...">`
6. Every `<Link to="/logs?run_id=...">` → `<Link to="/kaira/logs?run_id=...">`

**Commit**: `phase 5.9: port RunDetail page`

---

## Step 5.10: Port ThreadDetail Page

**File to create**: `src/features/evalRuns/pages/ThreadDetail.tsx`

Copy from `kaira-evals/src-ui/src/pages/ThreadDetail.tsx` with import substitutions.

Route path changes:
- `<Link to="/runs"...>` → `<Link to="/kaira/runs"...>`
- `<Link to={'/runs/${current.run_id}'}...>` → `<Link to={'/kaira/runs/${current.run_id}'}...>`

**Commit**: `phase 5.10: port ThreadDetail page`

---

## Step 5.11: Port AdversarialDetail Page

**File to create**: `src/features/evalRuns/pages/AdversarialDetail.tsx`

Copy from `kaira-evals/src-ui/src/pages/AdversarialDetail.tsx` with import substitutions.

Route path changes:
- `<Link to="/runs"...>` → `<Link to="/kaira/runs"...>`
- `<Link to={'/runs/${runId}'}...>` → `<Link to={'/kaira/runs/${runId}'}...>`

**Commit**: `phase 5.11: port AdversarialDetail page`

---

## Step 5.12: Port Logs Page

**File to create**: `src/features/evalRuns/pages/Logs.tsx`

Copy from `kaira-evals/src-ui/src/pages/Logs.tsx` with import substitutions.

Changes:
1. API imports from `@/services/api/evalRunsApi`
2. Route path changes:
   - `<Link to={'/runs/${log.run_id}'}...>` → `<Link to={'/kaira/runs/${log.run_id}'}...>`
   - `<Link to={'/runs/${runIdFilter}'}...>` → `<Link to={'/kaira/runs/${runIdFilter}'}...>`
3. Utility imports from `@/utils/evalFormatters`

**Commit**: `phase 5.12: port Logs page`

---

## Step 5.13: Create Page Barrel Export

**File to create**: `src/features/evalRuns/pages/index.ts`

```typescript
export { default as EvalDashboard } from './Dashboard';
export { default as EvalRunList } from './RunList';
export { default as EvalRunDetail } from './RunDetail';
export { default as EvalThreadDetail } from './ThreadDetail';
export { default as EvalAdversarialDetail } from './AdversarialDetail';
export { default as EvalLogs } from './Logs';
```

**File to create**: `src/features/evalRuns/index.ts`

```typescript
export * from './pages';
export * from './components';
```

**Commit**: `phase 5.13: create evalRuns feature barrel exports`

---

## Step 5.14: Update Sidebar for Kaira Bot — Nav Links

**File to edit**: `src/components/layout/KairaSidebarContent.tsx`

This is the key UI change. Add 3 static nav links ABOVE the search bar and chat sessions.

### Current structure:
```tsx
<>
  <div className="p-3">
    <Input placeholder={searchPlaceholder} ... />
  </div>
  <nav className="flex-1 overflow-y-auto px-2 pb-4">
    <ChatSessionList ... />
  </nav>
</>
```

### New structure:
```tsx
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ListChecks, ScrollText } from 'lucide-react';
import { cn } from '@/utils';

// Add this ABOVE the search bar:
<>
  {/* Eval nav links */}
  <nav className="px-2 pt-2 pb-1 space-y-0.5">
    <KairaNavLink to="/kaira/dashboard" icon={LayoutDashboard} label="Dashboard" />
    <KairaNavLink to="/kaira/runs" icon={ListChecks} label="Runs" />
    <KairaNavLink to="/kaira/logs" icon={ScrollText} label="Logs" />
  </nav>

  <div className="border-t border-[var(--border-subtle)] mx-3" />

  {/* Existing search + sessions */}
  <div className="p-3">
    <Input placeholder={searchPlaceholder} ... />
  </div>
  <nav className="flex-1 overflow-y-auto px-2 pb-4">
    <ChatSessionList ... />
  </nav>
</>
```

### KairaNavLink helper (add at bottom of file or inline):
```tsx
function KairaNavLink({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-[6px] px-3 py-2 text-[13px] font-medium transition-colors',
          isActive
            ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]'
        )
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </NavLink>
  );
}
```

**Styling notes**:
- Uses the platform's CSS variable theme (not hardcoded indigo like kaira-evals)
- Matches the existing sidebar styling for `Settings` link
- Active state uses the same `brand-accent` pattern as the rest of the sidebar

**Commit**: `phase 5.14: add Dashboard, Runs, Logs nav links to Kaira sidebar`

---

## Step 5.15: Update Collapsed Sidebar for Kaira Bot

**File to edit**: `src/components/layout/Sidebar.tsx`

In the collapsed sidebar section (lines ~268-306), when `isKairaBot` is true, show icons
for the 3 new nav items.

Find the collapsed sidebar's content area:
```tsx
<div className="flex-1 flex flex-col items-center py-3 gap-2">
  <Button size="sm" onClick={handleNewClick} ... >
    <Plus className="h-4 w-4" />
  </Button>
</div>
```

Add the kaira nav icons below the New button, conditionally for `isKairaBot`:
```tsx
<div className="flex-1 flex flex-col items-center py-3 gap-2">
  <Button size="sm" onClick={handleNewClick} ... >
    <Plus className="h-4 w-4" />
  </Button>

  {isKairaBot && (
    <>
      <div className="border-t border-[var(--border-subtle)] w-8 my-1" />
      <CollapsedNavLink to="/kaira/dashboard" icon={LayoutDashboard} title="Dashboard" />
      <CollapsedNavLink to="/kaira/runs" icon={ListChecks} title="Runs" />
      <CollapsedNavLink to="/kaira/logs" icon={ScrollText} title="Logs" />
    </>
  )}
</div>
```

Add `CollapsedNavLink` helper and imports:
```tsx
import { LayoutDashboard, ListChecks, ScrollText } from 'lucide-react';

function CollapsedNavLink({
  to,
  icon: Icon,
  title,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  const location = useLocation();
  const isActive = location.pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-[6px] transition-colors',
        isActive
          ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]'
      )}
      title={title}
    >
      <Icon className="h-5 w-5" />
    </Link>
  );
}
```

**Commit**: `phase 5.15: add collapsed sidebar icons for eval nav`

---

## Step 5.16: Add Routes to Router

**File to edit**: `src/app/Router.tsx`

Add the new routes under the Kaira Bot section:

```tsx
import {
  EvalDashboard,
  EvalRunList,
  EvalRunDetail,
  EvalThreadDetail,
  EvalAdversarialDetail,
  EvalLogs,
} from '@/features/evalRuns';

// Inside <Routes>:

{/* Kaira Bot routes */}
<Route path="/kaira" element={<KairaBotHomePage />} />
<Route path="/kaira/settings" element={<KairaBotSettingsPage />} />
<Route path="/kaira/settings/tags" element={<TagManagementPage />} />

{/* Kaira Evals routes (new) */}
<Route path="/kaira/dashboard" element={<EvalDashboard />} />
<Route path="/kaira/runs" element={<EvalRunList />} />
<Route path="/kaira/runs/:runId" element={<EvalRunDetail />} />
<Route path="/kaira/runs/:runId/adversarial/:evalId" element={<EvalAdversarialDetail />} />
<Route path="/kaira/threads/:threadId" element={<EvalThreadDetail />} />
<Route path="/kaira/logs" element={<EvalLogs />} />
```

**Commit**: `phase 5.16: add eval routes to Router`

---

## Step 5.17: Verify and Fix TypeScript Compilation

Run `npx tsc --noEmit` and fix any type errors.

Common issues to watch for:
- Missing exports from `@/types` barrel (ensure `evalRuns.ts` is re-exported)
- Import path mismatches (`../config/...` vs `@/config/...`)
- `recharts` types — may need `@types/recharts` or it may be included
- Component default export naming (kaira-evals uses `export default function X`)

**Commit**: `phase 5.17: fix TypeScript compilation errors`

---

## Step 5.18: Merge to Main

```bash
git checkout main
git merge feat/phase-5-evals-ui --no-ff -m "merge phase 5: kaira-evals Dashboard, Runs, Logs UI"
```

---

## Verification Checklist

After completing all steps, verify:

- [ ] Switch to Kaira Bot app in the sidebar
- [ ] Sidebar shows: Dashboard, Runs, Logs (3 links) → divider → search → chat sessions
- [ ] Collapsed sidebar shows 3 icons for the nav links
- [ ] Click Dashboard → `/kaira/dashboard` loads with stats cards, distribution bars, trend chart, recent runs
- [ ] Click Runs → `/kaira/runs` loads with filter tabs and run cards
- [ ] Click a run → `/kaira/runs/:id` shows detail with thread table, adversarial tests
- [ ] Click a thread → `/kaira/threads/:id` shows thread evaluation history
- [ ] Click Logs → `/kaira/logs` shows expandable log entries
- [ ] All internal links (run → logs, thread → run, etc.) navigate correctly under `/kaira/...`
- [ ] Settings link still works
- [ ] Voice Rx app sidebar is unchanged (no nav links, just search + listings)
- [ ] TypeScript compiles without errors

## Summary of Files Created/Modified

### New files (frontend):
```
src/types/evalRuns.ts
src/config/labelDefinitions.ts
src/utils/evalFormatters.ts
src/utils/evalColors.ts
src/services/api/evalRunsApi.ts
src/features/evalRuns/index.ts
src/features/evalRuns/components/index.ts
src/features/evalRuns/components/Tooltip.tsx
src/features/evalRuns/components/VerdictBadge.tsx
src/features/evalRuns/components/LabelBadge.tsx
src/features/evalRuns/components/MetricInfo.tsx
src/features/evalRuns/components/DistributionBar.tsx
src/features/evalRuns/components/TrendChart.tsx
src/features/evalRuns/components/RunCard.tsx
src/features/evalRuns/components/EvalSection.tsx
src/features/evalRuns/components/EvalTable.tsx
src/features/evalRuns/components/RuleComplianceGrid.tsx
src/features/evalRuns/components/TranscriptViewer.tsx
src/features/evalRuns/pages/index.ts
src/features/evalRuns/pages/Dashboard.tsx
src/features/evalRuns/pages/RunList.tsx
src/features/evalRuns/pages/RunDetail.tsx
src/features/evalRuns/pages/ThreadDetail.tsx
src/features/evalRuns/pages/AdversarialDetail.tsx
src/features/evalRuns/pages/Logs.tsx
```

### Modified files (frontend):
```
src/types/index.ts                                    (add evalRuns re-export)
src/services/api/index.ts                             (add evalRunsApi re-export)
src/components/layout/KairaSidebarContent.tsx          (add 3 nav links)
src/components/layout/Sidebar.tsx                      (add collapsed nav icons)
src/app/Router.tsx                                     (add 6 routes)
```

### Modified files (backend):
```
backend/app/routes/eval_runs.py                        (5 new endpoints + enriched stats)
backend/app/main.py                                    (register threads_router if using Option A)
```

### New dependency:
```
recharts (npm install recharts)
```
