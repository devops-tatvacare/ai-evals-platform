import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox';
import {
  listConnectionTemplates,
  type ProviderTemplateSummary,
} from '@/services/api/orchestrationConnections';

interface Props {
  /** WATI connection UUID. The picker is disabled until a connection is
   *  selected — without it we can't scope the live API call. */
  connectionId?: string;
  value: string;
  onChange(next: string): void;
  /** Fired whenever the operator selects a template (or the cached value
   *  resolves to a known template on mount). The inspector consumes this
   *  to refresh the variable-mapping editor's parameter slots. */
  onTemplateLoaded?(template: ProviderTemplateSummary | null): void;
}

/** Phase 13 / Phase C — live WATI template picker.
 *
 *  Replaces the legacy free-text template_name input. Backed by
 *  GET /api/orchestration/connections/{id}/templates which caches for
 *  30s on the server; Refresh bypasses the cache for the rare "I just
 *  approved a template in WATI" case. */
export function WatiTemplatePicker({
  connectionId,
  value,
  onChange,
  onTemplateLoaded,
}: Props) {
  const [items, setItems] = useState<ProviderTemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(
    async (refresh: boolean) => {
      if (!connectionId) {
        setItems([]);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await listConnectionTemplates(connectionId, { refresh });
        setItems(res.items);
        setError(res.error);
      } catch (err) {
        setItems([]);
        setError(err instanceof Error ? err.message : 'Failed to load templates');
      } finally {
        setLoading(false);
      }
    },
    [connectionId],
  );

  useEffect(() => {
    void fetchTemplates(false);
  }, [fetchTemplates]);

  // Whenever the items list or the selected name changes, surface the
  // template back to the inspector so the variable-mapping editor can
  // rebuild its slot list off the picker's parameters.
  useEffect(() => {
    if (!onTemplateLoaded) return;
    if (!value) {
      onTemplateLoaded(null);
      return;
    }
    const match = items.find((t) => t.name === value) ?? null;
    onTemplateLoaded(match);
  }, [items, value, onTemplateLoaded]);

  const options: ComboboxOption[] = items.map((t) => ({
    value: t.name,
    label: t.name,
    meta: t.language || t.status,
  }));

  if (!connectionId) {
    return (
      <p className="text-xs text-[var(--text-secondary)]">
        Pick a WATI connection above to load available templates.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Combobox
            options={options}
            value={value}
            onChange={onChange}
            placeholder={loading ? 'Loading templates…' : 'Select a template'}
            disabled={loading && items.length === 0}
            loading={loading}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          onClick={() => void fetchTemplates(true)}
          disabled={loading}
          aria-label="Refresh templates"
          className="shrink-0 whitespace-nowrap"
        >
          Refresh
        </Button>
      </div>
      {error && (
        <p className="text-xs text-[var(--color-error)]">{error}</p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="text-xs text-[var(--text-secondary)]">
          No templates found. Approve a template in WATI and click Refresh.
        </p>
      )}
    </div>
  );
}
