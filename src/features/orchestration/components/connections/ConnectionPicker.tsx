import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Combobox, type ComboboxOption } from '@/components/ui/Combobox';
import { getConnectionProviderLabel } from '@/features/orchestration/components/connections/providerOptions';
import { useOrchestrationRoutes } from '@/features/orchestration/hooks/useOrchestrationRoutes';
import {
  listConnections,
  type Connection,
} from '@/services/api/orchestrationConnections';

interface BasePickerProps {
  appId: string;
  value: string;
  onChange(connectionId: string): void;
  disabled?: boolean;
  /** Surfaced in the empty-state link copy. Falls back to the resolved
   *  connections route when omitted. */
  emptyCreateRoute?: string;
}

interface SingleProviderProps extends BasePickerProps {
  provider: string;
  providers?: never;
}

interface MultiProviderProps extends BasePickerProps {
  provider?: never;
  providers: readonly string[];
}

export type ConnectionPickerProps = SingleProviderProps | MultiProviderProps;

/** Small, fully token-styled wrapper around `Combobox` that lists active
 *  tenant connections filtered by provider (single or multi). When the
 *  list is empty an inline link routes the operator to the connections
 *  page so they can create one without losing their place. */
export function ConnectionPicker(props: ConnectionPickerProps) {
  const { appId, value, onChange, disabled, emptyCreateRoute } = props;
  const orchestrationRoutes = useOrchestrationRoutes();
  const singleProvider = 'provider' in props ? props.provider : undefined;
  const multiProviders = 'providers' in props ? props.providers : undefined;
  const providers = useMemo<readonly string[]>(() => {
    if (multiProviders) return multiProviders;
    if (singleProvider) return [singleProvider];
    return [];
  }, [multiProviders, singleProvider]);
  const providerKey = useMemo(() => providers.join('|'), [providers]);
  const providerFilter = useMemo(
    () => (providerKey ? providerKey.split('|') : []),
    [providerKey],
  );
  const queryKey = `${appId}:${providerKey}`;

  const [loaded, setLoaded] = useState<{
    key: string;
    rows: Connection[];
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    listConnections({
      appId,
      providers: providerFilter.length > 0 ? providerFilter : undefined,
    })
      .then((result) => {
        if (!alive) return;
        setLoaded({
          key: queryKey,
          rows: result,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoaded({
          key: queryKey,
          rows: [],
          error: err instanceof Error ? err.message : 'Failed to load connections',
        });
      });
    return () => {
      alive = false;
    };
  }, [appId, providerFilter, queryKey]);

  const rows = useMemo(
    () => (loaded?.key === queryKey ? loaded.rows : []),
    [loaded, queryKey],
  );
  const error = useMemo(
    () => (loaded?.key === queryKey ? loaded.error : null),
    [loaded, queryKey],
  );
  const loading = loaded?.key !== queryKey;

  const options: ComboboxOption[] = useMemo(() => {
    return rows.map((c) => ({
      value: c.id,
      label: c.name,
      meta: getConnectionProviderLabel(c.provider),
      searchText: `${c.provider} ${getConnectionProviderLabel(c.provider)} ${c.name}`,
    }));
  }, [rows]);

  const createRoute = emptyCreateRoute ?? orchestrationRoutes.connections;
  const placeholder =
    loading && rows.length === 0 ? 'Loading…' : 'Select a connection…';
  const emptyLabel = providers.length === 1 ? getConnectionProviderLabel(providers[0]) : 'matching';

  return (
    <div className="flex flex-col gap-1">
      <Combobox
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled || (loading && rows.length === 0)}
      />
      {!loading && rows.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">
          No active{' '}
          {providers.length === 1 ? (
            <span className="font-medium">{emptyLabel}</span>
          ) : (
            emptyLabel
          )}{' '}
          connections.{' '}
          <Link
            to={createRoute}
            className="text-[var(--text-brand)] underline underline-offset-2"
          >
            + New Connection
          </Link>
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-[var(--color-error)]">{error}</p>
      ) : null}
    </div>
  );
}
