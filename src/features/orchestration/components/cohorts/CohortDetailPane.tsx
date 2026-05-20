import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, X } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RightSlideOverShell } from '@/components/ui/RightSlideOverShell';
import {
  useCohort,
  useCohortUsedBy,
  useCreateDraftVersion,
  useDeleteCohort,
  useEditDraftVersion,
  usePublishVersion,
} from '@/features/orchestration/queries/cohorts';
import {
  decodeApiError,
  type ApiErrorBody,
} from '@/features/orchestration/contracts/errorDecoder';
import { useOrchestrationRoutes } from '@/features/orchestration/hooks/useOrchestrationRoutes';
import type {
  CohortFilter,
  CohortVersionResponse,
} from '@/services/api/orchestrationCohorts';
import { notificationService } from '@/services/notifications';
import { timeAgo } from '@/utils/evalFormatters';
import { CohortFiltersEditor } from './CohortFiltersEditor';

interface Props {
  cohortId: string;
  onClose: () => void;
}

const STATUS_VARIANT: Record<CohortVersionResponse['status'], 'success' | 'warning' | 'neutral'> = {
  published: 'success',
  draft: 'warning',
  archived: 'neutral',
};

export function CohortDetailPane({ cohortId, onClose }: Props) {
  const titleId = useId();
  const { data: cohort, isLoading } = useCohort(cohortId);
  const { data: usedBy = [] } = useCohortUsedBy(cohortId);
  const publishMutation = usePublishVersion(cohortId);
  const editDraftMutation = useEditDraftVersion(cohortId);
  const createDraftMutation = useCreateDraftVersion(cohortId);
  const deleteMutation = useDeleteCohort();
  const routes = useOrchestrationRoutes();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<ApiErrorBody | null>(null);
  // Per-draft filter buffer. Falls back to the persisted version.filters
  // at render time so we never need an effect to seed it.
  const [draftFilters, setDraftFilters] = useState<Record<string, CohortFilter[]>>({});

  async function handleDelete() {
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync(cohortId);
      notificationService.success('Cohort deleted.');
      setConfirmDelete(false);
      onClose();
    } catch (err) {
      const decoded = decodeApiError(err);
      setDeleteError(decoded);
      setConfirmDelete(false);
    }
  }

  async function handlePublish(versionId: string) {
    try {
      await publishMutation.mutateAsync(versionId);
      notificationService.success('Version published.');
    } catch (err) {
      const decoded = decodeApiError(err);
      const msg =
        decoded.kind === 'message'
          ? decoded.message
          : 'Failed to publish version.';
      notificationService.error(msg);
    }
  }

  async function handleSaveDraft(version: CohortVersionResponse) {
    const filters = draftFilters[version.id] ?? version.filters;
    try {
      await editDraftMutation.mutateAsync({
        versionId: version.id,
        payload: {
          sourceRef: version.sourceRef,
          payloadFields: version.payloadFields,
          filters,
          lookbackHours: version.lookbackHours,
          lookbackColumn: version.lookbackColumn,
          consentGateChannel: version.consentGateChannel,
        },
      });
      notificationService.success('Draft saved.');
    } catch (err) {
      const decoded = decodeApiError(err);
      notificationService.error(
        decoded.kind === 'message' ? decoded.message : 'Failed to save draft.',
      );
    }
  }

  async function handleNewDraft() {
    if (!cohort || cohort.versions.length === 0) return;
    // Clone the latest version (published or draft) as the starting point
    // for the next draft. Authors typically iterate on the most recent
    // shape, not v1.
    const seed = cohort.versions[0];
    try {
      const created = await createDraftMutation.mutateAsync({
        sourceRef: seed.sourceRef,
        payloadFields: seed.payloadFields,
        filters: seed.filters,
        lookbackHours: seed.lookbackHours,
        lookbackColumn: seed.lookbackColumn,
        consentGateChannel: seed.consentGateChannel,
      });
      notificationService.success(`Draft v${created.version} created.`);
    } catch (err) {
      const decoded = decodeApiError(err);
      notificationService.error(
        decoded.kind === 'message' ? decoded.message : 'Failed to create draft.',
      );
    }
  }

  return (
    <RightSlideOverShell isOpen={true} onClose={onClose} labelledBy={titleId}>
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id={titleId}
            className="truncate text-base font-semibold text-[var(--text-primary)]"
          >
            {cohort?.name ?? (isLoading ? 'Loading…' : 'Cohort')}
          </h2>
          {cohort ? (
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <Badge variant={cohort.visibility === 'shared' ? 'info' : 'neutral'} size="sm">
                {cohort.visibility}
              </Badge>
              {cohort.currentPublishedVersionId ? (
                <Badge variant="success" size="sm">Published</Badge>
              ) : (
                <Badge variant="warning" size="sm">Draft only</Badge>
              )}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
        {/* Used in workflows */}
        <section>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            Used in workflows
          </h3>
          {usedBy.length === 0 ? (
            <p className="text-[13px] text-[var(--text-muted)]">
              Not used in any workflow yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {usedBy.map((b) => (
                <li key={b.workflowVersionId} className="text-[13px]">
                  <Link
                    to={routes.campaignBuilder(b.workflowId)}
                    className="text-[var(--text-primary)] hover:text-[var(--color-brand-accent)]"
                  >
                    {b.workflowName}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Versions */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Versions
            </h3>
            {cohort && cohort.versions.length > 0 && !cohort.versions.some((v) => v.status === 'draft') ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleNewDraft()}
                isLoading={createDraftMutation.isPending}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> New draft
              </Button>
            ) : null}
          </div>
          {!cohort || cohort.versions.length === 0 ? (
            <p className="text-[13px] text-[var(--text-muted)]">No versions.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
              {cohort.versions.map((v) => (
                <li key={v.id} className="flex flex-col gap-2 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] text-[var(--text-primary)]">
                          v{v.version}
                        </span>
                        <Badge variant={STATUS_VARIANT[v.status]} size="sm">
                          {v.status}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-[var(--text-secondary)]">
                        {v.filters.length} filter{v.filters.length === 1 ? '' : 's'} on{' '}
                        <span className="font-mono">{v.sourceRef}</span>
                        {v.publishedAt
                          ? ` · published ${timeAgo(v.publishedAt)}`
                          : ` · created ${timeAgo(v.createdAt)}`}
                      </p>
                    </div>
                    {v.status === 'draft' ? (
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleSaveDraft(v)}
                          isLoading={
                            editDraftMutation.isPending &&
                            editDraftMutation.variables?.versionId === v.id
                          }
                        >
                          Save draft
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handlePublish(v.id)}
                          isLoading={
                            publishMutation.isPending && publishMutation.variables === v.id
                          }
                        >
                          Publish version
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {v.status === 'draft' ? (
                    <CohortFiltersEditor
                      value={draftFilters[v.id] ?? v.filters}
                      onChange={(next) =>
                        setDraftFilters((prev) => ({ ...prev, [v.id]: next }))
                      }
                      disabled={
                        editDraftMutation.isPending || publishMutation.isPending
                      }
                    />
                  ) : v.filters.length > 0 ? (
                    <ul className="ml-1 flex flex-col gap-0.5 text-[11px] text-[var(--text-secondary)]">
                      {v.filters.map((f, idx) => (
                        <li key={idx}>
                          <span className="font-mono">{f.column}</span> {f.op}{' '}
                          <span className="font-mono">
                            {Array.isArray(f.value)
                              ? (f.value as unknown[]).map(String).join(', ')
                              : String(f.value)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Delete error (409 in-use) */}
        {deleteError && deleteError.kind === 'fieldErrors' ? (
          <section className="rounded-md border border-[var(--border-error)] bg-[var(--surface-error)] p-3">
            <p className="mb-2 text-[13px] font-medium text-[var(--color-error)]">
              Can&apos;t delete this cohort yet
            </p>
            <p className="mb-2 text-[12px] text-[var(--text-secondary)]">
              This cohort is used by {deleteError.items.length} workflow
              {deleteError.items.length === 1 ? '' : 's'}. Remove the cohort from each
              workflow (or delete the workflow) before deleting it here.
            </p>
            <ul className="flex flex-col gap-1 text-[12px]">
              {deleteError.items.map((item, idx) => {
                const workflowId = item.nodeId ?? '';
                return (
                  <li key={`${item.nodeId}-${idx}`}>
                    {workflowId ? (
                      <Link
                        to={routes.campaignBuilder(workflowId)}
                        className="text-[var(--text-primary)] hover:text-[var(--color-brand-accent)]"
                      >
                        {item.message}
                      </Link>
                    ) : (
                      <span>{item.message}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {deleteError && deleteError.kind === 'message' ? (
          <p role="alert" className="text-[12px] text-[var(--color-error)]">
            {deleteError.message}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--border-default)] px-5 py-3">
        <Button
          variant="danger-outline"
          onClick={() => setConfirmDelete(true)}
          disabled={isLoading || deleteMutation.isPending}
          className="gap-1.5"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete cohort"
        description={
          cohort
            ? `Delete "${cohort.name}"? This deactivates the cohort; workflows that still pin one of its versions will block the delete.`
            : ''
        }
        confirmLabel={deleteMutation.isPending ? 'Deleting…' : 'Delete'}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </RightSlideOverShell>
  );
}
