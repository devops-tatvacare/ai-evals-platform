import { useEffect, useId, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';

import {
  Badge,
  Button,
  CapabilityChips,
  Combobox,
  ConfirmDialog,
  EmptyState,
  Input,
  RightSlideOverShell,
  Switch,
} from '@/components/ui';
import { notificationService } from '@/services/notifications';
import {
  useCreateDeployment,
  useDeleteDeployment,
  useTenantDeployments,
  useUpdateDeployment,
} from '@/services/api/llmCredentialsQueries';
import { useLlmCatalog } from '@/services/api/llmModelsQueries';
import type { CapabilityTag } from '@/services/api/llmModelsApi';
import type { TenantDeployment } from '@/services/api/llmCredentialsApi';

interface AzureDeploymentEditorProps {
  credentialId: string;
  credentialName: string;
}

/**
 * Nested editor under each Azure credential card. Surfaces every row in
 * `tenant_llm_deployments` for the credential, lets admins add/edit/delete
 * deployments and map them to canonical models. `api_version_override` lives
 * per-row to handle cases where one deployment on a resource needs a
 * different API version than its siblings.
 */
export function AzureDeploymentEditor({
  credentialId,
  credentialName,
}: AzureDeploymentEditorProps) {
  const { data: deployments = [], isLoading } = useTenantDeployments(credentialId);
  const deleteMut = useDeleteDeployment(credentialId);

  const [editorState, setEditorState] = useState<
    { mode: 'create' } | { mode: 'edit'; deployment: TenantDeployment } | null
  >(null);
  const [pendingDelete, setPendingDelete] = useState<TenantDeployment | null>(
    null,
  );

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
      notificationService.success(
        `Deployment "${pendingDelete.deploymentName}" removed`,
      );
      setPendingDelete(null);
    } catch (err) {
      notificationService.error(
        err instanceof Error ? err.message : 'Delete failed',
      );
    }
  };

  return (
    <div className="mt-4 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Deployments
        </h4>
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          onClick={() => setEditorState({ mode: 'create' })}
        >
          Add
        </Button>
      </div>

      {isLoading ? (
        <div className="px-3 py-4 text-[12px] text-[var(--text-muted)]">
          Loading deployments…
        </div>
      ) : deployments.length === 0 ? (
        <EmptyState
          icon={Plus}
          title="No deployments declared"
          description="Add a deployment to make models from this Azure resource selectable."
          compact
          bordered={false}
        />
      ) : (
        <div className="divide-y divide-[var(--border-subtle)] rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
          {deployments.map((d) => (
            <DeploymentRow
              key={d.id}
              deployment={d}
              onEdit={() => setEditorState({ mode: 'edit', deployment: d })}
              onDelete={() => setPendingDelete(d)}
            />
          ))}
        </div>
      )}

      {editorState && (
        <DeploymentSlideOver
          open
          credentialId={credentialId}
          credentialName={credentialName}
          deployment={
            editorState.mode === 'edit' ? editorState.deployment : null
          }
          onClose={() => setEditorState(null)}
        />
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        title="Delete deployment?"
        description={
          pendingDelete
            ? `Delete deployment "${pendingDelete.deploymentName}"? Any LLM Default referencing it will fall back to the platform default until you remap.`
            : ''
        }
        confirmLabel="Delete deployment"
        variant="danger"
        isLoading={deleteMut.isPending}
      />
    </div>
  );
}

interface DeploymentRowProps {
  deployment: TenantDeployment;
  onEdit: () => void;
  onDelete: () => void;
}

function DeploymentRow({ deployment, onEdit, onDelete }: DeploymentRowProps) {
  // Status carries the full meaning — pill on the right, no redundant status
  // text in the secondary line.
  const statusBadge = deployment.needsMapping ? (
    <Badge variant="warning">needs mapping</Badge>
  ) : !deployment.enabled ? (
    <Badge variant="neutral">disabled</Badge>
  ) : (
    <Badge variant="success">ready</Badge>
  );

  const target = deployment.needsMapping
    ? null
    : (deployment.canonicalModel ?? null);

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
          {deployment.deploymentName}
        </div>
        <div className="truncate text-[11px] text-[var(--text-muted)]">
          {target ? `→ ${target}` : 'unmapped'}
          {deployment.apiVersionOverride
            ? ` · api ${deployment.apiVersionOverride}`
            : ''}
        </div>
      </div>
      <div className="shrink-0">{statusBadge}</div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={Trash2}
          onClick={onDelete}
          aria-label={`Delete ${deployment.deploymentName}`}
        />
      </div>
    </div>
  );
}

interface SlideOverProps {
  open: boolean;
  credentialId: string;
  credentialName: string;
  deployment: TenantDeployment | null;
  onClose: () => void;
}

function DeploymentSlideOver({
  open,
  credentialId,
  credentialName,
  deployment,
  onClose,
}: SlideOverProps) {
  const titleId = useId();
  const isCreate = deployment === null;
  const create = useCreateDeployment(credentialId);
  const update = useUpdateDeployment(credentialId);
  // Azure deployments map to OpenAI canonical models — the Responses API and
  // chat-completions surfaces are OpenAI-shaped, so the catalog filter is
  // hardcoded to openai.
  const { data: catalog = [], isLoading: catalogLoading } = useLlmCatalog({
    provider: 'openai',
    includeDeprecated: true,
  });

  const [deploymentName, setDeploymentName] = useState(
    deployment?.deploymentName ?? '',
  );
  const [canonicalModelId, setCanonicalModelId] = useState(
    deployment?.canonicalModelId ?? '',
  );
  const [apiVersionOverride, setApiVersionOverride] = useState(
    deployment?.apiVersionOverride ?? '',
  );
  const [enabled, setEnabled] = useState(deployment?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDeploymentName(deployment?.deploymentName ?? '');
    setCanonicalModelId(deployment?.canonicalModelId ?? '');
    setApiVersionOverride(deployment?.apiVersionOverride ?? '');
    setEnabled(deployment?.enabled ?? true);
    setError(null);
  }, [deployment]);

  const catalogOptions = useMemo(
    () =>
      catalog.map((c) => ({
        value: c.id,
        label: c.displayName || c.model,
        meta: c.displayName && c.displayName !== c.model ? c.model : undefined,
        description: (
          <CapabilityChips tags={c.capabilities as CapabilityTag[]} />
        ),
      })),
    [catalog],
  );

  const handleSave = async () => {
    setError(null);
    if (!deploymentName.trim()) {
      setError('Deployment name is required');
      return;
    }
    setSaving(true);
    try {
      if (isCreate) {
        await create.mutateAsync({
          deploymentName: deploymentName.trim(),
          canonicalModelId: canonicalModelId || null,
          apiVersionOverride: apiVersionOverride.trim() || null,
          enabled,
        });
        notificationService.success(`Deployment "${deploymentName}" added`);
      } else {
        await update.mutateAsync({
          deploymentId: deployment!.id,
          body: {
            canonicalModelId: canonicalModelId || null,
            apiVersionOverride: apiVersionOverride.trim() || null,
            enabled,
          },
        });
        notificationService.success(`Deployment "${deploymentName}" updated`);
      }
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
      notificationService.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <RightSlideOverShell
      isOpen={open}
      onClose={onClose}
      labelledBy={titleId}
      widthClassName="w-[var(--overlay-width-sm)] max-w-[85vw]"
      zIndexClassName="z-[var(--z-popover)]"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-6 py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[15px] font-semibold text-[var(--text-primary)]"
            >
              {isCreate ? 'Add deployment' : 'Edit deployment'}
            </h2>
            <p className="truncate text-[12px] text-[var(--text-muted)]">
              On Azure credential <code>{credentialName}</code>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <Field label="Deployment name">
            <Input
              value={deploymentName}
              onChange={(e) => setDeploymentName(e.target.value)}
              placeholder="dubbings-gpt-4o-transcribe"
              disabled={!isCreate}
            />
            {!isCreate && (
              <FieldHint>
                Deployment name is immutable — delete and re-add to rename.
              </FieldHint>
            )}
          </Field>

          <Field label="Canonical model">
            <Combobox
              value={canonicalModelId}
              options={catalogOptions}
              placeholder={
                catalogLoading ? 'Loading catalog…' : 'Pick canonical model'
              }
              disabled={catalogLoading}
              onChange={setCanonicalModelId}
            />
            <FieldHint>
              Drives capability filtering and pricing lookup.
            </FieldHint>
          </Field>

          <Field label="API version override (optional)">
            <Input
              value={apiVersionOverride}
              onChange={(e) => setApiVersionOverride(e.target.value)}
              placeholder="e.g. 2025-03-01-preview"
            />
            <FieldHint>
              Leave blank to inherit the credential's API version.
            </FieldHint>
          </Field>

          <div className="flex items-center justify-between">
            <label className="text-[12px] font-medium text-[var(--text-primary)]">
              Enabled
            </label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {error && (
            <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error-light)] px-3 py-2 text-[12px] text-[var(--color-error)]">
              {error}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-6 py-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isCreate ? 'Add deployment' : 'Save changes'}
          </Button>
        </footer>
      </div>
    </RightSlideOverShell>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-[var(--text-primary)]">
        {label}
      </label>
      {children}
    </div>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] text-[var(--text-muted)]">{children}</p>;
}
