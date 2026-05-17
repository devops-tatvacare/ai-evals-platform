import type { ThreadEvalRow } from '@/types';

/** Reads the call-quality overall score from a thread row's nested result. */
export function getOverallScore(thread: ThreadEvalRow): number | null {
  const result = thread.result as unknown as Record<string, unknown> | undefined;
  if (!result) return null;
  const evals = result.evaluations as Array<Record<string, unknown>> | undefined;
  if (evals && evals.length > 0) {
    const output = evals[0].output as Record<string, unknown> | undefined;
    if (output && typeof output.overall_score === 'number') return output.overall_score;
  }
  const output = result.output as Record<string, unknown> | undefined;
  if (output && typeof output.overall_score === 'number') return output.overall_score;
  return null;
}
