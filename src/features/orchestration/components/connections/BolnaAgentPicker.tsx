import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox';
import { useBolnaAgents } from '@/features/orchestration/queries/referenceData';

interface Props {
  /** Connection UUID this dispatch node points at. The picker is disabled
   *  until the upstream connection is selected — without it we can't
   *  scope the live API call. */
  connectionId?: string;
  value: string;
  onChange(next: string): void;
}

/** Phase 14 — Bolna agent picker, now backed by TanStack Query.
 *
 *  Replaces the Phase-13 hand-rolled `useEffect` + `useState` fetch loop.
 *  Reopening the inspector within the 30 s `staleTime` reuses the cached
 *  data without a network roundtrip. The Refresh button calls `refresh()`
 *  which bypasses both the FE and BE caches for the rare "I just created
 *  the agent in Bolna" case. */
export function BolnaAgentPicker({ connectionId, value, onChange }: Props) {
  const { data, isFetching, error, refresh } = useBolnaAgents(connectionId);

  const agents = data?.items ?? [];
  const errorMessage =
    error instanceof Error
      ? error.message
      : data?.error
        ? data.error
        : null;

  const options: ComboboxOption[] = agents.map((a) => ({
    value: a.id,
    label: a.name || a.id,
    meta: a.status,
  }));

  if (!connectionId) {
    return (
      <p className="text-xs text-[var(--text-secondary)]">
        Pick a Bolna connection above to load available agents.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Combobox
            options={options}
            value={value}
            onChange={onChange}
            placeholder={isFetching ? 'Loading agents…' : 'Select an agent'}
            disabled={isFetching && agents.length === 0}
            loading={isFetching}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          onClick={() => void refresh()}
          disabled={isFetching}
          aria-label="Refresh agents"
        >
          Refresh
        </Button>
      </div>
      {errorMessage && (
        <p className="text-xs text-[var(--color-error)]">{errorMessage}</p>
      )}
      {!isFetching && !errorMessage && agents.length === 0 && (
        <p className="text-xs text-[var(--text-secondary)]">
          No agents found. Create one in Bolna and click Refresh.
        </p>
      )}
    </div>
  );
}
