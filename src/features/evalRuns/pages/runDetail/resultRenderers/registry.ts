import type { ComponentType } from 'react';
import type { EvalType } from '@/types/evalRuns';
import { CallQualityResults } from './callQualityResults';
import { FullEvaluationResults } from './fullEvaluationResults';
import { CustomEvalResults } from './customEvalResults';
import { BatchThreadResults } from './batchThreadResults';
import { BatchAdversarialResults } from './batchAdversarialResults';

/**
 * One renderer per `eval_type`. Each `Body` declares its own props because the
 * data shape it consumes is eval-type-specific (call rows vs critique segments
 * vs thread evals vs adversarial cases). Dispatch sites import the renderer
 * directly to keep prop typing tight; this registry exists so the eval-type →
 * module mapping is a single discoverable list and Phase 3 has something to
 * resolve from `App.config.runDetail.evalTypes`.
 */
export interface ResultRendererEntry {
  // Loosely typed at the registry boundary on purpose — see Phase 3 for a
  // typed dispatch model. Each renderer module exports its own typed
  // component for direct use.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Body: ComponentType<any>;
}

export const RESULT_RENDERERS: Record<EvalType, ResultRendererEntry> = {
  call_quality: { Body: CallQualityResults },
  full_evaluation: { Body: FullEvaluationResults },
  custom: { Body: CustomEvalResults },
  batch_thread: { Body: BatchThreadResults },
  batch_adversarial: { Body: BatchAdversarialResults },
};
