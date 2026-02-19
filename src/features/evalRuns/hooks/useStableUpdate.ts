import { useRef, useCallback } from 'react';
import type { Run, EvalRun } from '@/types';

/**
 * Returns a setter that only updates state when data actually changed.
 * Compares by id + status + summary JSON to avoid full-page shimmer on polling.
 */
function fingerprint(items: Array<{ id: string; status: string; summary?: unknown }>): string {
  return items.map((i) => `${i.id}:${i.status}:${JSON.stringify(i.summary ?? '')}`).join('|');
}

export function useStableRunUpdate(setter: React.Dispatch<React.SetStateAction<Run[]>>) {
  const ref = useRef('');
  return useCallback(
    (incoming: Run[]) => {
      const normalized = incoming.map((r) => ({
        id: r.run_id,
        status: r.status,
        summary: r.summary,
      }));
      const fp = fingerprint(normalized);
      if (fp !== ref.current) {
        ref.current = fp;
        setter(incoming);
      }
    },
    [setter],
  );
}

export function useStableEvalRunUpdate(setter: React.Dispatch<React.SetStateAction<EvalRun[]>>) {
  const ref = useRef('');
  return useCallback(
    (incoming: EvalRun[]) => {
      const normalized = incoming.map((r) => ({
        id: r.id,
        status: r.status,
        summary: r.summary,
      }));
      const fp = fingerprint(normalized);
      if (fp !== ref.current) {
        ref.current = fp;
        setter(incoming);
      }
    },
    [setter],
  );
}
