import {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, Download, FileJson, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RightSlideOverShell } from '@/components/ui/RightSlideOverShell';
import { notificationService } from '@/services/notifications';
import {
  createTrigger,
  getWorkflow,
  listTriggers,
  validateWorkflowPayload,
  type WorkflowValidateResponse,
} from '@/services/api/orchestration';
import {
  decodeApiError,
  summarizeApiErrorBody,
} from '@/features/orchestration/contracts/errorDecoder';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';
import type {
  WorkflowDefinition,
  WorkflowDefinitionNode,
  WorkflowType,
} from '@/features/orchestration/types';
import { PublishErrorPanel } from './PublishErrorPanel';

const SCHEMA_VERSION = 1;

/** Credential / template binding fields stripped on portable export — the importer must re-bind. */
const BINDING_FIELDS = [
  'connection_id',
  'agent_id',
  'from_phone',
  'template_slug',
  'template_name',
  'channel_number',
  'broadcast_name',
  'template_id',
  'provider_template_id',
] as const;

interface WorkflowExportEnvelope {
  schemaVersion: number;
  workflow: {
    name: string;
    description: string | null;
    appId: string;
    workflowType: WorkflowType;
    visibility: string;
  };
  definition: WorkflowDefinition;
  triggers: Array<{
    kind: 'cron' | 'event' | 'manual';
    cronExpression: string | null;
    eventName: string | null;
    params: Record<string, unknown>;
    active: boolean;
  }>;
  layout: {
    viewport: { x: number; y: number; zoom: number } | null;
  };
  exportedAt: string;
}

interface ImportPreviewState {
  envelope: WorkflowExportEnvelope;
  response: WorkflowValidateResponse;
  warningsAboutEnvelope: string[];
}

interface WorkflowJsonIOProps {
  workflowId: string | null;
}

export interface WorkflowJsonIOHandle {
  openExport: () => void;
  openImport: () => void;
}

/** Mounts the file picker, export ConfirmDialog, and import-preview
 *  slide-over for the workflow builder. State is transient (panel-open
 *  flags + selected file) so it lives here rather than in the global
 *  builder store. The parent triggers actions via the imperative ref. */
export const WorkflowJsonIO = forwardRef<WorkflowJsonIOHandle, WorkflowJsonIOProps>(
function WorkflowJsonIO({ workflowId }, ref) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewTitleId = useId();
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewState | null>(null);
  const [applying, setApplying] = useState(false);

  const openExport = useCallback(() => {
    if (!workflowId) return;
    setExportOpen(true);
  }, [workflowId]);

  const openImport = useCallback(() => {
    if (!workflowId) return;
    fileInputRef.current?.click();
  }, [workflowId]);

  const handleExport = useCallback(
    async (includeBindings: boolean) => {
      if (!workflowId) return;
      setExporting(true);
      try {
        const [workflow, triggers] = await Promise.all([
          getWorkflow(workflowId),
          listTriggers(workflowId).catch(() => []),
        ]);
        const store = useWorkflowBuilderStore.getState();
        const definition = store.toDefinition();
        const sanitizedDefinition = includeBindings
          ? definition
          : stripBindingsFromDefinition(definition);
        const envelope: WorkflowExportEnvelope = {
          schemaVersion: SCHEMA_VERSION,
          workflow: {
            name: workflow.name,
            description: workflow.description ?? null,
            appId: workflow.appId,
            workflowType: workflow.workflowType,
            visibility: workflow.visibility ?? 'private',
          },
          definition: sanitizedDefinition,
          triggers: triggers.map((t) => ({
            kind: t.kind,
            cronExpression: t.cronExpression ?? null,
            eventName: t.eventName ?? null,
            params: t.params ?? {},
            active: t.active,
          })),
          layout: { viewport: store.viewport ?? null },
          exportedAt: new Date().toISOString(),
        };
        downloadJson(buildExportFilename(workflow.name), envelope);
        notificationService.success(
          includeBindings
            ? 'Exported workflow JSON (with bindings)'
            : 'Exported workflow JSON (bindings stripped)',
        );
      } catch (err) {
        notificationService.error(
          summarizeApiErrorBody(decodeApiError(err), 'Export failed'),
        );
      } finally {
        setExporting(false);
        setExportOpen(false);
      }
    },
    [workflowId],
  );

  const handleFileChosen = useCallback(
    async (file: File) => {
      if (!workflowId) return;
      const envelopeWarnings: string[] = [];
      let envelope: WorkflowExportEnvelope;
      try {
        const text = await file.text();
        envelope = JSON.parse(text) as WorkflowExportEnvelope;
      } catch {
        notificationService.error('That file is not valid JSON.');
        return;
      }
      const shapeError = validateEnvelopeShape(envelope);
      if (shapeError) {
        notificationService.error(shapeError);
        return;
      }
      const wf = await getWorkflow(workflowId).catch(() => null);
      if (!wf) {
        notificationService.error(
          'Failed to load the current workflow — refresh and try again.',
        );
        return;
      }
      if (envelope.workflow.appId !== wf.appId) {
        envelopeWarnings.push(
          `Exported under app "${envelope.workflow.appId}" — importing into "${wf.appId}".`,
        );
      }
      if (envelope.workflow.workflowType !== wf.workflowType) {
        notificationService.error(
          `Workflow type mismatch — file is "${envelope.workflow.workflowType}" but this workflow is "${wf.workflowType}". Create a new ${envelope.workflow.workflowType} workflow first.`,
        );
        return;
      }
      try {
        const response = await validateWorkflowPayload({
          appId: wf.appId,
          workflowType: wf.workflowType,
          definition: envelope.definition,
        });
        setPreview({ envelope, response, warningsAboutEnvelope: envelopeWarnings });
      } catch (err) {
        notificationService.error(
          summarizeApiErrorBody(decodeApiError(err), 'Validation failed'),
        );
      }
    },
    [workflowId],
  );

  const handleImportApply = useCallback(async () => {
    if (!preview || !workflowId) return;
    setApplying(true);
    try {
      const store = useWorkflowBuilderStore.getState();
      // Strip any `_parseIssues` annotations that may have ridden along in
      // a hand-edited file — the store's hydrate path re-runs parse on
      // every node, so stale annotations are noise.
      const cleanDefinition: WorkflowDefinition = {
        ...preview.response.normalizedDefinition,
        nodes: (preview.response.normalizedDefinition.nodes ?? []).map((n) => {
          if (!('_parseIssues' in n)) return n;
          const rest = { ...n };
          delete (rest as { _parseIssues?: unknown })._parseIssues;
          return rest;
        }),
      };
      store.hydrate(cleanDefinition, { mode: 'load' });
      store.setViewMode('edit');
      // Triggers piggy-back the workflow row, not the version. Restore them
      // best-effort; per-trigger failures don't roll back the definition
      // import because the user can re-add a trigger from the side panel.
      const failedTriggers: string[] = [];
      for (const t of preview.envelope.triggers ?? []) {
        try {
          await createTrigger(workflowId, {
            kind: t.kind,
            cronExpression: t.cronExpression ?? undefined,
            eventName: t.eventName ?? undefined,
            params: t.params ?? {},
            active: t.active,
          });
        } catch {
          failedTriggers.push(t.kind);
        }
      }
      notificationService.success(
        failedTriggers.length === 0
          ? 'Imported — review the canvas, then save the draft to persist.'
          : `Imported — ${failedTriggers.length} trigger(s) failed to attach; re-add them from the side panel.`,
      );
      setPreview(null);
    } finally {
      setApplying(false);
    }
  }, [preview, workflowId]);

  useImperativeHandle(ref, () => ({ openExport, openImport }), [openExport, openImport]);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFileChosen(f);
          // Reset so re-selecting the same file fires onChange again.
          e.target.value = '';
        }}
      />
      <ConfirmDialog
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        onConfirm={() => void handleExport(true)}
        title="Include credentials and template references?"
        description={
          '“Yes — full replication” keeps connection IDs, agent IDs, and template names in the file so a re-import into the same tenant lands ready to publish. ' +
          '“No — portable copy” blanks those binding fields so the file is safe to share across tenants; the importer must rebind credentials in the builder before publishing.'
        }
        confirmLabel="Yes — full replication"
        cancelLabel="Cancel"
        variant="primary"
        isLoading={exporting}
        icon={Download}
        extraActions={[
          {
            label: 'No — portable copy',
            onClick: () => void handleExport(false),
            variant: 'secondary',
          },
        ]}
      />
      <RightSlideOverShell
        isOpen={preview !== null}
        onClose={() => (applying ? undefined : setPreview(null))}
        labelledBy={previewTitleId}
      >
        {preview ? (
          <ImportPreviewBody
            titleId={previewTitleId}
            preview={preview}
            applying={applying}
            onCancel={() => setPreview(null)}
            onApply={() => void handleImportApply()}
          />
        ) : (
          // RightSlideOverShell mounts via AnimatePresence; non-open render is fine.
          <div />
        )}
      </RightSlideOverShell>
    </>
  );
});

function ImportPreviewBody({
  titleId,
  preview,
  applying,
  onCancel,
  onApply,
}: {
  titleId: string;
  preview: ImportPreviewState;
  applying: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  const { envelope, response, warningsAboutEnvelope } = preview;
  const nodeCount = response.normalizedDefinition.nodes?.length ?? 0;
  const edgeCount = response.normalizedDefinition.edges?.length ?? 0;
  const triggerCount = envelope.triggers?.length ?? 0;
  const fieldErrorsBody = useMemo(
    () =>
      response.errors.length > 0
        ? ({
            kind: 'fieldErrors' as const,
            items: response.errors.map((e) => ({
              nodeId: e.nodeId,
              field: e.field,
              message: e.message,
            })),
          })
        : null,
    [response.errors],
  );
  const blocked = !response.ok || response.errors.length > 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileJson className="h-4 w-4 text-[var(--text-secondary)]" />
            <h2 id={titleId} className="text-sm font-semibold text-[var(--text-primary)]">
              Import preview
            </h2>
          </div>
          <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
            {envelope.workflow.name}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={applying}
          aria-label="Close import preview"
          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
        <SummaryTable
          rows={[
            ['Nodes', String(nodeCount)],
            ['Edges', String(edgeCount)],
            ['Triggers', String(triggerCount)],
            ['Workflow type', envelope.workflow.workflowType],
            ['Exported app', envelope.workflow.appId],
          ]}
        />
        {warningsAboutEnvelope.length > 0 ? (
          <WarningBlock title="Heads up">
            <ul className="space-y-1 text-xs">
              {warningsAboutEnvelope.map((m, idx) => (
                <li key={idx}>{m}</li>
              ))}
            </ul>
          </WarningBlock>
        ) : null}
        {response.warnings.length > 0 ? (
          <WarningBlock
            title={`${response.warnings.length} warning${response.warnings.length === 1 ? '' : 's'} — rebind before publish`}
          >
            <ul className="space-y-1.5 text-xs">
              {response.warnings.map((w, idx) => (
                <li key={idx}>
                  {w.nodeId ? <span className="font-medium">{w.nodeId}</span> : null}
                  {w.nodeId && w.field ? ' · ' : null}
                  {w.field ? <span>{w.field}</span> : null}
                  {(w.nodeId || w.field) ? ': ' : null}
                  <span className="text-[var(--text-secondary)]">{w.message}</span>
                </li>
              ))}
            </ul>
          </WarningBlock>
        ) : null}
        {fieldErrorsBody ? (
          <PublishErrorPanel body={fieldErrorsBody} />
        ) : null}
        {!blocked && response.warnings.length === 0 && warningsAboutEnvelope.length === 0 ? (
          <p className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            Validation passed. Confirm to load the canvas, then save the draft to
            persist.
          </p>
        ) : null}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
        <Button variant="ghost" onClick={onCancel} disabled={applying}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={onApply}
          disabled={blocked || applying}
          title={blocked ? 'Fix the errors above before importing' : undefined}
        >
          <Upload className="mr-1 h-3.5 w-3.5" />
          {applying ? 'Importing…' : 'Import to canvas'}
        </Button>
      </footer>
    </div>
  );
}

function SummaryTable({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[var(--text-secondary)]">{k}</dt>
          <dd className="font-medium text-[var(--text-primary)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function WarningBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-[var(--color-warning)] bg-[var(--bg-tertiary)] px-3 py-2">
      <AlertTriangle
        aria-hidden="true"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]"
      />
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--color-warning)]">
          {title}
        </div>
        <div className="text-[var(--text-primary)]">{children}</div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripBindingsFromDefinition(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const nodes: WorkflowDefinitionNode[] = (definition.nodes ?? []).map((n) => {
    if (!n.config) return n;
    const stripped: Record<string, unknown> = { ...n.config };
    let touched = false;
    for (const key of BINDING_FIELDS) {
      if (key in stripped) {
        delete stripped[key];
        touched = true;
      }
    }
    return touched ? { ...n, config: stripped } : n;
  });
  return { ...definition, nodes };
}

const ALLOWED_WORKFLOW_TYPES: ReadonlySet<WorkflowType> = new Set(['crm', 'clinical']);

function validateEnvelopeShape(envelope: unknown): string | null {
  if (!envelope || typeof envelope !== 'object') {
    return 'Envelope must be a JSON object.';
  }
  const e = envelope as Partial<WorkflowExportEnvelope>;
  if (typeof e.schemaVersion !== 'number') {
    return 'Missing schemaVersion.';
  }
  if (e.schemaVersion !== SCHEMA_VERSION) {
    return `Unsupported schemaVersion ${e.schemaVersion}. This builder reads version ${SCHEMA_VERSION}.`;
  }
  if (!e.workflow || typeof e.workflow !== 'object') return 'Missing workflow header.';
  if (typeof e.workflow.workflowType !== 'string') return 'Missing workflow.workflowType.';
  if (!ALLOWED_WORKFLOW_TYPES.has(e.workflow.workflowType as WorkflowType)) {
    return `workflow.workflowType must be one of ${[...ALLOWED_WORKFLOW_TYPES].join(', ')} (got "${e.workflow.workflowType}").`;
  }
  if (typeof e.workflow.appId !== 'string' || !e.workflow.appId) {
    return 'Missing workflow.appId.';
  }
  if (!e.definition || typeof e.definition !== 'object') return 'Missing definition.';
  if (!Array.isArray(e.definition.nodes)) return 'definition.nodes must be an array.';
  if (!Array.isArray(e.definition.edges)) return 'definition.edges must be an array.';
  if (e.triggers !== undefined && !Array.isArray(e.triggers)) {
    return 'triggers must be an array when present.';
  }
  return null;
}

function buildExportFilename(name: string): string {
  const slug = (name || 'workflow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'workflow';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${slug}-${stamp}.json`;
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
