import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Layers, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Combobox,
  ConfirmDialog,
  DataTable,
  Input,
  ProviderTag,
  Switch,
  type ColumnDef,
  type ComboboxOption,
} from '@/components/ui';
import { notificationService } from '@/services/notifications';
import { costApi } from '@/services/api/costApi';
import { usePermission } from '@/utils/permissions';
import { useCostStore } from '@/stores/costStore';
import { formatDateTime, formatInt } from '../utils/format';
import type { AliasRow, CatalogRow, UnmappedModelRow } from '../types';

interface TabProps {
  active: boolean;
}

interface UnmappedRowState extends UnmappedModelRow {
  selectedCanonical: string;
  busy: boolean;
}

export function UnmappedTab({ active }: TabProps) {
  const canEdit = usePermission('cost:edit');
  const pricing = useCostStore((s) => s.pricing);
  const loadPricing = useCostStore((s) => s.loadPricing);

  const [unmapped, setUnmapped] = useState<UnmappedRowState[]>([]);
  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Manual-add form state — used when an admin needs to recreate an alias
  // that was previously deleted. The Unmapped feed only surfaces pairs with
  // ``llm_usage.pricing_fallback=true``; after a delete, historical rows
  // stay repriced and the pair is invisible until new usage arrives.
  const [addProvider, setAddProvider] = useState('');
  const [addObserved, setAddObserved] = useState('');
  const [addCanonical, setAddCanonical] = useState('');
  const [addSystemScope, setAddSystemScope] = useState(false);
  const [addBusy, setAddBusy] = useState(false);

  // Delete-confirm modal state.
  const [pendingDelete, setPendingDelete] = useState<AliasRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, a] = await Promise.all([
        costApi.fetchUnmappedModels(),
        costApi.fetchAliases(),
      ]);
      setUnmapped(
        u.rows.map((r) => ({
          ...r,
          selectedCanonical: r.suggestedCanonical ?? '',
          busy: false,
        })),
      );
      setAliases(a.aliases);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load unmapped models');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    // Keep catalog warm for the canonical dropdown; costStore's pricing slice
    // carries the catalog bundle used by the Pricing tab.
    if (!pricing.data) void loadPricing();
  }, [active, load, pricing.data, loadPricing]);

  const catalogByProvider = useMemo<Record<string, CatalogRow[]>>(() => {
    const bucket: Record<string, CatalogRow[]> = {};
    for (const c of pricing.data?.catalog ?? []) {
      (bucket[c.provider] ??= []).push(c);
    }
    return bucket;
  }, [pricing.data]);

  const catalogOptionsFor = useCallback(
    (provider: string): ComboboxOption[] =>
      (catalogByProvider[provider] ?? []).map((c) => ({
        value: c.model,
        label: c.displayName || c.model,
        searchText: `${c.model} ${c.displayName ?? ''} ${c.family ?? ''}`,
        meta: c.family || undefined,
      })),
    [catalogByProvider],
  );

  // Provider options come from distinct providers in the catalog — same
  // source of truth as ``catalogByProvider``. No hardcoded provider list.
  const providerOptions = useMemo<ComboboxOption[]>(
    () =>
      Object.keys(catalogByProvider)
        .sort()
        .map((p) => ({ value: p, label: p, searchText: p })),
    [catalogByProvider],
  );

  const handleCanonicalChange = useCallback((rowKey: string, value: string) => {
    setUnmapped((prev) =>
      prev.map((r) =>
        `${r.provider}:${r.model}` === rowKey ? { ...r, selectedCanonical: value } : r,
      ),
    );
  }, []);

  const handleMap = useCallback(
    async (row: UnmappedRowState) => {
      if (!row.selectedCanonical) {
        notificationService.warning('Pick a canonical model first');
        return;
      }
      const rowKey = `${row.provider}:${row.model}`;
      setUnmapped((prev) => prev.map((r) => (`${r.provider}:${r.model}` === rowKey ? { ...r, busy: true } : r)));
      try {
        const alias = await costApi.upsertAlias({
          provider: row.provider,
          observed: row.model,
          canonical: row.selectedCanonical,
          tenantScope: 'tenant',
        });
        const reprice = await costApi.repriceAlias(alias.id);
        notificationService.success(
          `Mapped ${row.model} → ${row.selectedCanonical} · repriced ${reprice.repriced} row${reprice.repriced === 1 ? '' : 's'}`,
        );
        await load();
      } catch (e) {
        notificationService.error(e instanceof Error ? e.message : 'Failed to map model');
        setUnmapped((prev) => prev.map((r) => (`${r.provider}:${r.model}` === rowKey ? { ...r, busy: false } : r)));
      }
    },
    [load],
  );

  const confirmDeleteAlias = useCallback(async () => {
    if (!pendingDelete || !canEdit) return;
    setDeleteBusy(true);
    try {
      await costApi.deleteAlias(pendingDelete.id);
      notificationService.success(`Removed alias ${pendingDelete.observed}`);
      setPendingDelete(null);
      await load();
    } catch (e) {
      notificationService.error(e instanceof Error ? e.message : 'Failed to remove alias');
    } finally {
      setDeleteBusy(false);
    }
  }, [pendingDelete, canEdit, load]);

  const handleAddAlias = useCallback(async () => {
    if (!canEdit) return;
    const provider = addProvider.trim();
    const observed = addObserved.trim();
    const canonical = addCanonical.trim();
    if (!provider || !observed || !canonical) {
      notificationService.warning('Pick a provider, observed model, and canonical model');
      return;
    }
    setAddBusy(true);
    try {
      const alias = await costApi.upsertAlias({
        provider,
        observed,
        canonical,
        tenantScope: addSystemScope ? 'system' : 'tenant',
      });
      const reprice = await costApi.repriceAlias(alias.id);
      notificationService.success(
        `Added alias ${observed} → ${canonical} · repriced ${reprice.repriced} row${reprice.repriced === 1 ? '' : 's'}`,
      );
      setAddProvider('');
      setAddObserved('');
      setAddCanonical('');
      setAddSystemScope(false);
      await load();
    } catch (e) {
      notificationService.error(e instanceof Error ? e.message : 'Failed to add alias');
    } finally {
      setAddBusy(false);
    }
  }, [canEdit, addProvider, addObserved, addCanonical, addSystemScope, load]);

  // Reset the canonical picker whenever the provider changes — a canonical
  // model only makes sense within the chosen provider's catalog.
  const handleAddProviderChange = useCallback((value: string) => {
    setAddProvider(value);
    setAddCanonical('');
  }, []);

  const unmappedColumns: ColumnDef<UnmappedRowState>[] = [
    {
      key: 'provider',
      header: 'Provider',
      width: 'w-32',
      render: (r) => <ProviderTag value={r.provider} />,
    },
    {
      key: 'model',
      header: 'Observed model',
      render: (r) => <span className="font-mono">{r.model}</span>,
    },
    {
      key: 'callCount',
      header: 'Calls',
      width: 'w-20',
      cellClassName: 'text-right tabular-nums',
      headerClassName: 'text-right',
      render: (r) => <span className="text-[var(--text-secondary)]">{formatInt(r.callCount)}</span>,
    },
    {
      key: 'lastSeenAt',
      header: 'Last seen',
      width: 'w-40',
      render: (r) => <span className="text-[var(--text-muted)]">{formatDateTime(r.lastSeenAt)}</span>,
    },
    {
      key: 'canonical',
      header: 'Map to',
      render: (r) => {
        const rowKey = `${r.provider}:${r.model}`;
        return (
          <Combobox
            size="sm"
            options={catalogOptionsFor(r.provider)}
            value={r.selectedCanonical}
            onChange={(v) => handleCanonicalChange(rowKey, v)}
            placeholder="Pick canonical model"
            disabled={!canEdit || r.busy}
            className="w-[260px]"
          />
        );
      },
    },
    {
      key: 'action',
      header: '',
      width: 'w-28',
      cellClassName: 'text-right',
      render: (r) => (
        <Button
          size="sm"
          variant="primary"
          icon={CheckCircle2}
          disabled={!canEdit || !r.selectedCanonical || r.busy}
          isLoading={r.busy}
          onClick={() => handleMap(r)}
        >
          Map
        </Button>
      ),
    },
  ];

  const aliasColumns: ColumnDef<AliasRow>[] = [
    {
      key: 'scope',
      header: 'Scope',
      width: 'w-24',
      render: (r) => (
        <span className="text-[var(--text-secondary)]">
          {r.tenantId === null ? 'System' : 'Tenant'}
        </span>
      ),
    },
    {
      key: 'provider',
      header: 'Provider',
      width: 'w-32',
      render: (r) => <ProviderTag value={r.provider} />,
    },
    {
      key: 'observed',
      header: 'Observed',
      render: (r) => <span className="font-mono">{r.observed}</span>,
    },
    {
      key: 'canonical',
      header: 'Canonical',
      render: (r) => <span className="font-mono text-[var(--text-brand)]">{r.canonical}</span>,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      width: 'w-40',
      textBehavior: 'nowrap',
      render: (r) => <span className="text-[var(--text-muted)]">{formatDateTime(r.updatedAt)}</span>,
    },
    {
      key: 'action',
      header: '',
      width: 'w-16',
      cellClassName: 'text-right',
      render: (r) => (
        <Button
          size="sm"
          variant="ghost"
          icon={Trash2}
          disabled={!canEdit || (r.tenantId === null)}
          title={r.tenantId === null ? 'System aliases are platform-wide' : 'Remove alias'}
          onClick={() => setPendingDelete(r)}
        />
      ),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 pb-6">
      <section>
        <header className="mb-2 flex items-center justify-between">
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
              Needs mapping
            </h3>
            <p className="text-[12px] text-[var(--text-muted)]">
              Observed models with no pricing match. Pick a canonical model from the models.dev catalog; historical rows are re-priced automatically.
            </p>
          </div>
          {!canEdit && (
            <span className="text-[11px] text-[var(--text-muted)]">
              Requires <code className="font-mono">cost:edit</code> to map
            </span>
          )}
        </header>
        {error ? (
          <div className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-[12px] text-[var(--color-danger)]">
            {error}
          </div>
        ) : loading ? (
          <div className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-[12px] text-[var(--text-muted)]">
            Loading…
          </div>
        ) : unmapped.length === 0 ? (
          <div className="flex items-center gap-2 rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-[12px] text-[var(--text-muted)]">
            <Layers className="h-4 w-4" />
            <span>No unmapped models — every logged call resolves to a pricing row.</span>
          </div>
        ) : (
          <DataTable<UnmappedRowState>
            data={unmapped}
            columns={unmappedColumns}
            keyExtractor={(r: UnmappedRowState) => `${r.provider}:${r.model}`}
          />
        )}
      </section>

      <section>
        <header className="mb-2">
          <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Current aliases</h3>
          <p className="text-[12px] text-[var(--text-muted)]">
            Tenant aliases take precedence over system-wide defaults.
          </p>
        </header>

        {canEdit && (
          <div className="mb-3 rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-medium text-[var(--text-primary)]">Add alias manually</span>
              <label className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                <span>System scope</span>
                <Switch
                  size="sm"
                  checked={addSystemScope}
                  onCheckedChange={setAddSystemScope}
                  disabled={addBusy}
                  aria-label="System-wide scope"
                />
              </label>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(140px,0.6fr)_minmax(200px,1fr)_minmax(200px,1fr)_auto]">
              <Combobox
                size="sm"
                options={providerOptions}
                value={addProvider}
                onChange={handleAddProviderChange}
                placeholder="Provider"
                disabled={addBusy || providerOptions.length === 0}
              />
              {/* Match the h-7 / text-[13px] rhythm of size="sm" Combobox + Button
                  so the row renders at one uniform height. Input itself has no
                  ``size`` prop; the design-system sm convention lives in those
                  siblings, so we pin the same classes here rather than invent a
                  third height. */}
              <Input
                value={addObserved}
                onChange={(e) => setAddObserved(e.target.value)}
                placeholder="Observed model (as seen in llm_usage)"
                disabled={addBusy}
                className="h-7 px-2.5 text-[13px]"
              />
              <Combobox
                size="sm"
                options={catalogOptionsFor(addProvider)}
                value={addCanonical}
                onChange={setAddCanonical}
                placeholder={addProvider ? 'Canonical model' : 'Pick provider first'}
                disabled={addBusy || !addProvider}
              />
              <Button
                size="sm"
                variant="primary"
                icon={Plus}
                isLoading={addBusy}
                disabled={!addProvider || !addObserved.trim() || !addCanonical || addBusy}
                onClick={handleAddAlias}
              >
                Add
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">
              Drift is auto-detected in the Needs mapping list above. Use this form to add a mapping
              manually when needed.
            </p>
          </div>
        )}

        {aliases.length === 0 ? (
          <div className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-[12px] text-[var(--text-muted)]">
            No aliases yet.
          </div>
        ) : (
          <DataTable<AliasRow> data={aliases} columns={aliasColumns} keyExtractor={(r: AliasRow) => r.id} />
        )}
      </section>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => {
          if (!deleteBusy) setPendingDelete(null);
        }}
        onConfirm={() => void confirmDeleteAlias()}
        title="Remove alias?"
        description={
          pendingDelete
            ? `Remove mapping ${pendingDelete.observed} → ${pendingDelete.canonical}? ` +
              `Future ${pendingDelete.provider} calls logged under "${pendingDelete.observed}" will fall back to unpriced ` +
              `until a new alias is added. Historical rows already repriced are unaffected.`
            : ''
        }
        confirmLabel="Remove alias"
        variant="danger"
        isLoading={deleteBusy}
      />
    </div>
  );
}
