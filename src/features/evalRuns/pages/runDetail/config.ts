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
  enabledForEvalTypes: z.array(evalTypeSchema).optional(),
});

const drilldownSchema = z.object({
  paramName: z.string(),
  route: z.string(),
  backLabel: z.string(),
});

const extrasSchema = z.object({
  /** Mount InlineReviewProvider + review-aware summary section. Kaira only today. */
  review: z.boolean().optional(),
  /** Adversarial axes side panel + retry-failed-cases header action. Kaira only. */
  adversarialAxes: z.boolean().optional(),
  /** Header button + right slide-over showing raw `run.result` JSON. Voice-rx only. */
  rawPayload: z.boolean().optional(),
  /** Adds a "History" tab backed by `ReviewHistoryTab`. Kaira only. */
  historyTab: z.boolean().optional(),
  /** Drill-down sub-route (e.g. `/calls/:callId`). Inside-sales only. */
  drilldown: drilldownSchema.optional(),
});

const behaviourSchema = z.object({
  /** Tab strip hides while the run is active. Kaira pattern. */
  hideTabsWhileActive: z.boolean().optional(),
  /** Failed-run banner replaces the body entirely (no metric cards). Inside-sales pattern. */
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
export const runDetailConfigSchema = z.object({
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
