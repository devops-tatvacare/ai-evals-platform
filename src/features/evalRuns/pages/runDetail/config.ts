import { z } from 'zod';
import type { EvalType } from '@/types/evalRuns';

const evalTypeSchema = z.enum([
  'custom',
  'full_evaluation',
  'call_quality',
  'batch_thread',
  'batch_adversarial',
]) satisfies z.ZodType<EvalType>;

const reportTabSchema = z.object({
  enabled: z.boolean(),
  /** Restrict the Report tab to a subset of `evalTypes`; omit = all. */
  enabledForEvalTypes: z.array(evalTypeSchema).nullish(),
});

const drilldownSchema = z.object({
  paramName: z.string(),
  route: z.string(),
  backLabel: z.string(),
});

const extrasSchema = z.object({
  /** Mount InlineReviewProvider + review-aware summary section. Batch shape only. */
  review: z.boolean().optional(),
  /** Adversarial axes side panel + retry-failed-cases header action. Batch shape only. */
  adversarialAxes: z.boolean().optional(),
  /** Header button + right slide-over showing raw `run.result` JSON. */
  rawPayload: z.boolean().optional(),
  /** Adds a "History" tab backed by `ReviewHistoryTab`. Batch shape only. */
  historyTab: z.boolean().optional(),
  /** Drill-down sub-route (e.g. `/calls/:callId`). Single shape only. */
  // `.nullish()` (not `.optional()`) because the backend Pydantic model
  // `AppRunDetailExtrasConfig.drilldown: AppRunDetailDrilldownConfig | None = None`
  // is serialized by CamelModel as JSON `null` when unset, not as a missing key.
  // Same reason applies to `enabledForEvalTypes` above.
  drilldown: drilldownSchema.nullish(),
});

const behaviourSchema = z.object({
  /** Tab strip hides while the run is active. */
  hideTabsWhileActive: z.boolean().optional(),
  /** Failed-run banner replaces the body entirely (no metric cards). */
  bannerOnlyOnFailed: z.boolean().optional(),
  /** Status banner pulls the failure step from `run.result.failedStep` for the headline. */
  failureHeadlineFromResult: z.boolean().optional(),
});

/**
 * Per-app run-detail surface config. Lives at `App.config.runDetail` and is
 * the source of truth for which eval types the surface renders, which extras
 * (review mode, drill-down, raw payload, history tab) mount, and which
 * behaviour flags gate chrome decisions.
 *
 * Zod-parsed at read time via `useAppRunDetailConfig` so an app whose seed
 * config block drifts from this schema fails fast with a clear error rather
 * than silently rendering a half-broken page.
 */
/**
 * Run shape selects the dispatcher path inside `useRunDetail`:
 * - `single` — one `EvalRun` row (camelCase shape); optional call drilldown.
 * - `batch` — one `Run` row (snake_case shape) with thread + adversarial sub-rows.
 */
export const runShapeSchema = z.enum(['single', 'batch']);
export type RunShape = z.infer<typeof runShapeSchema>;

export const runDetailConfigSchema = z.object({
  runShape: runShapeSchema,
  evalTypes: z.array(evalTypeSchema).min(1),
  reportTab: reportTabSchema,
  extras: extrasSchema,
  behaviour: behaviourSchema,
});

export type RunDetailConfig = z.infer<typeof runDetailConfigSchema>;
export type RunDetailExtras = z.infer<typeof extrasSchema>;
export type RunDetailBehaviour = z.infer<typeof behaviourSchema>;
export type RunDetailReportTab = z.infer<typeof reportTabSchema>;
export type RunDetailDrilldown = z.infer<typeof drilldownSchema>;
