import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox';
import {
  listConnectionAgents,
  type ProviderAgentSummary,
} from '@/services/api/orchestrationConnections';

interface Props {
  /** Connection UUID this dispatch node points at. The picker is disabled
   *  until the upstream connection is selected — without it we can't
   *  scope the live API call. */
  connectionId?: string;
  value: string;
  onChange(next: string): void;
}

/** Phase 13 / Phase B — live Bolna agent picker.
 *
 *  Replaces the legacy free-text ``override_agent_id`` input. Backed by the
 *  ``GET /api/orchestration/connections/{id}/agents`` endpoint which caches
 *  for 30s on the server; the Refresh button bypasses the cache for the
 *  rare "I just created the agent in Bolna" case. */
export function BolnaAgentPicker({ connectionId, value, onChange }: Props) {
  const [agents, setAgents] = useState<ProviderAgentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(
    async (refresh: boolean) => {
      if (!connectionId) {
        setAgents([]);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await listConnectionAgents(connectionId, { refresh });
        setAgents(res.items);
        setError(res.error);
      } catch (err) {
        setAgents([]);
        setError(err instanceof Error ? err.message : 'Failed to load agents');
      } finally {
        setLoading(false);
      }
    },
    [connectionId],
  );

  useEffect(() => {
    void fetchAgents(false);
  }, [fetchAgents]);

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
            placeholder={loading ? 'Loading agents…' : 'Select an agent'}
            disabled={loading && agents.length === 0}
            loading={loading}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          onClick={() => void fetchAgents(true)}
          disabled={loading}
          aria-label="Refresh agents"
        >
          Refresh
        </Button>
      </div>
      {error && (
        <p className="text-xs text-[var(--color-error)]">{error}</p>
      )}
      {!loading && !error && agents.length === 0 && (
        <p className="text-xs text-[var(--text-secondary)]">
          No agents found. Create one in Bolna and click Refresh.
        </p>
      )}
    </div>
  );
}
