import { useEffect, useState } from 'react';

import { Combobox, type ComboboxOption } from '@/components/ui/Combobox';
import {
  listActionTemplates,
  type ActionTemplate,
} from '@/services/api/orchestration';

interface Props {
  appId?: string;
  channel: string;
  value: string;
  onChange(next: string): void;
}

export function ActionTemplatePicker({ appId, channel, value, onChange }: Props) {
  const [items, setItems] = useState<ActionTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appId || !channel) {
      setItems([]);
      setError(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await listActionTemplates({ appId, channel });
        if (!cancelled) {
          setItems(next.filter((item) => item.active));
        }
      } catch (err) {
        if (!cancelled) {
          setItems([]);
          setError(err instanceof Error ? err.message : 'Failed to load templates');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [appId, channel]);

  useEffect(() => {
    if (!value && items.length === 1) {
      onChange(items[0].slug);
    }
  }, [items, onChange, value]);

  if (!appId) {
    return (
      <p className="text-xs text-[var(--color-error)]">
        Action template picker requires an app context.
      </p>
    );
  }

  const options: ComboboxOption[] = items.map((item) => ({
    value: item.slug,
    label: item.name,
    meta: item.slug,
  }));

  return (
    <div className="flex flex-col gap-1">
      <Combobox
        options={options}
        value={value}
        onChange={onChange}
        placeholder={loading ? 'Loading action templates…' : 'Select an action template'}
        disabled={loading && items.length === 0}
        loading={loading}
      />
      {error ? (
        <p className="text-xs text-[var(--color-error)]">{error}</p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">
          No internal action templates are available for this channel.
        </p>
      ) : null}
    </div>
  );
}
