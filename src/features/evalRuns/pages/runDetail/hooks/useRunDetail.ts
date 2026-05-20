import type { AppId } from '@/types';
import { useAppRunDetailConfig } from './useAppRunDetailConfig';
import { useSingleEvaluationRunDetail } from './useSingleEvaluationRunDetail';
import { useBatchEvaluationRunDetail } from './useBatchEvaluationRunDetail';
import type { RunDetailView } from '../types';

/**
 * Single run-detail entry point for `RunDetailPage`. Dispatches to the
 * shape-specific hook based on `App.config.runDetail.runShape`:
 *
 * - `single` — `EvalRun` row, optional call drilldown (voice-rx, inside-sales).
 * - `batch`  — `Run` row with thread + adversarial sub-rows (kaira-bot).
 *
 * No app-named files survive under `runDetail/` — per-app behaviour comes
 * from the seeded config row. Adding a new app to the surface means seeding
 * `App.config.runDetail` with one of the two shapes; no new entry file, no
 * new switch case.
 *
 * Both shape hooks are always invoked even though only one renders, because
 * Rules of Hooks forbid conditional hook calls. The non-active hook reads
 * the same `useAppRunDetailConfig(appId)` and exits at the loading phase
 * without firing network requests if its branch isn't selected.
 */
export function useRunDetail(
  appId: AppId,
  runId: string,
  callId: string | undefined,
): RunDetailView {
  const detailConfig = useAppRunDetailConfig(appId);
  const single = useSingleEvaluationRunDetail(
    appId,
    detailConfig.runShape === 'single' ? runId : '',
    detailConfig.runShape === 'single' ? callId : undefined,
  );
  const batch = useBatchEvaluationRunDetail(
    appId,
    detailConfig.runShape === 'batch' ? runId : '',
  );
  return detailConfig.runShape === 'batch' ? batch : single;
}
