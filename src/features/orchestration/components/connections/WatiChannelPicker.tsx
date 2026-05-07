import { useCallback, useEffect, useState } from 'react';

import { Select } from '@/components/ui/Select';
import {
  getConnection,
  type Connection,
} from '@/services/api/orchestrationConnections';

interface Props {
  /** WATI connection UUID. Picker is disabled until a connection is
   *  selected — without it there's no channel_numbers list to draw from. */
  connectionId?: string;
  value: string;
  onChange(next: string): void;
}

/** Phase 13 / Phase C — channel-number picker driven by the connection's
 *  ``channel_numbers`` config (Phase A). Pure dropdown — no live API call
 *  beyond the connection fetch, since these numbers are tenant-managed
 *  in the connection form. */
export function WatiChannelPicker({ connectionId, value, onChange }: Props) {
  const [channels, setChannels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChannels = useCallback(async () => {
    if (!connectionId) {
      setChannels([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const conn: Connection = await getConnection(connectionId);
      const raw = conn.configRedacted.channel_numbers;
      const arr = Array.isArray(raw)
        ? raw.filter((s): s is string => typeof s === 'string' && s.length > 0)
        : [];
      setChannels(arr);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void fetchChannels();
  }, [fetchChannels]);

  if (!connectionId) {
    return (
      <p className="text-xs text-[var(--text-secondary)]">
        Pick a WATI connection above to load channel numbers.
      </p>
    );
  }
  if (loading) {
    return (
      <p className="text-xs text-[var(--text-secondary)]">Loading channels…</p>
    );
  }
  if (error) {
    return <p className="text-xs text-[var(--color-error)]">{error}</p>;
  }
  if (channels.length === 0) {
    return (
      <p className="text-xs text-[var(--text-secondary)]">
        Add channel numbers to this connection first.
      </p>
    );
  }

  return (
    <Select
      value={value}
      onChange={onChange}
      options={channels.map((c) => ({ value: c, label: c }))}
      placeholder="Select a channel number"
    />
  );
}
