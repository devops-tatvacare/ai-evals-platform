import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';

import { Button, CapabilityChips, Combobox } from '@/components/ui';
import type { CapabilityTag } from '@/services/api/llmModelsApi';
import { useLlmCatalog } from '@/services/api/llmModelsQueries';
import {
  useAddCuratedModel,
  useCuratedModels,
  useRemoveCuratedModel,
} from '@/services/api/llmCredentialsQueries';
import type {
  CuratedModel,
  LlmProvider,
} from '@/services/api/llmCredentialsApi';
import { notificationService } from '@/services/notifications';

interface ModelCurationProps {
  credentialId: string;
  provider: LlmProvider;
}

/**
 * Nested model curator under each non-Azure credential card. Curated rows are
 * the only models surfaced in call-site dropdowns for this credential (the
 * runtime gate is strict — an empty set hides every option). Azure curates via
 * deployments instead, so that provider mounts AzureDeploymentEditor.
 */
export function ModelCuration({ credentialId, provider }: ModelCurationProps) {
  const { data: curated = [], isLoading } = useCuratedModels(credentialId);
  // Curated rows are keyed by the catalog row UUID; the picker must resolve
  // the chosen model to its catalog id, so drive it straight from the catalog.
  const { data: catalog = [], isLoading: catalogLoading } = useLlmCatalog({
    provider,
    includeDeprecated: false,
  });
  const addMut = useAddCuratedModel(credentialId);
  const removeMut = useRemoveCuratedModel(credentialId);

  const curatedIds = useMemo(
    () => new Set(curated.map((c) => c.canonicalModelId)),
    [curated],
  );

  // Curated rows don't carry capabilities; resolve them from the catalog by id
  // so each selected row can render the same chips as the picker options.
  const capabilitiesById = useMemo(
    () => new Map(catalog.map((c) => [c.id, c.capabilities as CapabilityTag[]])),
    [catalog],
  );

  const addOptions = useMemo(
    () =>
      catalog
        .filter((c) => !curatedIds.has(c.id))
        .map((c) => ({
          value: c.id,
          label: c.displayName || c.model,
          meta:
            c.displayName && c.displayName !== c.model ? c.model : undefined,
          description: (
            <CapabilityChips tags={c.capabilities as CapabilityTag[]} />
          ),
        })),
    [catalog, curatedIds],
  );

  const handleAdd = async (canonicalModelId: string) => {
    if (!canonicalModelId) return;
    try {
      await addMut.mutateAsync(canonicalModelId);
      notificationService.success('Model added');
    } catch (err) {
      notificationService.error(
        err instanceof Error ? err.message : 'Could not add model',
      );
    }
  };

  const handleRemove = async (row: CuratedModel) => {
    try {
      await removeMut.mutateAsync(row.id);
      notificationService.success(`Removed ${row.displayName || row.model}`);
    } catch (err) {
      notificationService.error(
        err instanceof Error ? err.message : 'Could not remove model',
      );
    }
  };

  return (
    <div className="mt-4 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Models
        </h4>
        <span className="text-[11px] text-[var(--text-muted)]">
          {curated.length} selected
        </span>
      </div>

      <div className="mt-2">
        <Combobox
          value=""
          options={addOptions}
          placeholder={
            catalogLoading
              ? 'Loading catalog…'
              : addOptions.length === 0
                ? 'All catalog models added'
                : 'Add models…'
          }
          disabled={
            catalogLoading || addMut.isPending || addOptions.length === 0
          }
          onChange={handleAdd}
        />
      </div>

      {isLoading ? (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          Loading models…
        </p>
      ) : curated.length === 0 ? (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          No models added yet — added models become selectable everywhere this
          credential is used.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--border-subtle)] rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
          {curated.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-2 px-3 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]">
                {row.displayName || row.model}
              </span>
              <CapabilityChips
                tags={capabilitiesById.get(row.canonicalModelId) ?? []}
                className="shrink-0"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={Trash2}
                aria-label={`Remove ${row.displayName || row.model}`}
                disabled={removeMut.isPending}
                onClick={() => handleRemove(row)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
