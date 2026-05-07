import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FlaskConical,
  MoreHorizontal,
  Pencil,
  Play,
  Save,
  Send,
  Timeline,
} from 'lucide-react';
import { useWorkflowRuns } from '@/features/orchestration/queries/runs';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { cn } from '@/utils/cn';
import {
  createDraftVersion,
  fireManualRun,
  getWorkflow,
  publishVersion,
} from '@/services/api/orchestration';
import type { WorkflowRun } from '@/features/orchestration/types';
import { notificationService } from '@/services/notifications';
import {
  useLifecycleState,
  useWorkflowBuilderStore,
} from '@/features/orchestration/store/workflowBuilderStore';
import { useOrchestrationRoutes } from '@/features/orchestration/hooks/useOrchestrationRoutes';
import {
  decodeApiError,
  summarizeApiErrorBody,
  type ApiErrorBody,
} from '@/features/orchestration/contracts/errorDecoder';
import {
  canPublish,
  canSave,
  pillLabel,
  type LifecycleState,
} from '@/features/orchestration/contracts/lifecycleState';
import { PublishErrorPanel } from './PublishErrorPanel';

interface WorkflowHeaderBarProps {
  onRunStarted?: (run: WorkflowRun) => void;
  /** Open the run inspector overlay. Pass a run id to deep-link to that
   *  run; pass `null` to open the inspector with the picker only (the
   *  "browse runs" entry point). The page owns the URL state. */
  onOpenRuns?: (runId: string | null) => void;
}

export function WorkflowHeaderBar({
  onRunStarted,
  onOpenRuns,
}: WorkflowHeaderBarProps) {
  const navigate = useNavigate();
  const orchestrationRoutes = useOrchestrationRoutes();
  const workflowId = useWorkflowBuilderStore((s) => s.workflowId);
  const versionId = useWorkflowBuilderStore((s) => s.versionId);
  const name = useWorkflowBuilderStore((s) => s.workflowName);
  const workflowType = useWorkflowBuilderStore((s) => s.workflowType);
  const inFlight = useWorkflowBuilderStore((s) => s.inFlight);
  const currentPublishedVersionId = useWorkflowBuilderStore(
    (s) => s.currentPublishedVersionId,
  );
  const lifecycle = useLifecycleState();

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  /** Last publish error in structured form. Cleared on the next publish
   *  attempt so the panel doesn't linger past a successful retry. */
  const [publishError, setPublishError] = useState<ApiErrorBody | null>(null);

  // Lifecycle drives every visible state. `hasUnsavedChanges` is the
  // discriminated check the leave-confirm + publish-needs-save logic want;
  // both `dirty-draft` and `dirty-published-edits` produce it.
  const hasUnsavedChanges =
    lifecycle.kind === 'dirty-draft' ||
    lifecycle.kind === 'dirty-published-edits' ||
    lifecycle.kind === 'save-failed' ||
    lifecycle.kind === 'publish-failed';

  const handleBack = () => {
    if (hasUnsavedChanges) {
      setShowLeaveConfirm(true);
      return;
    }
    navigate(orchestrationRoutes.campaigns);
  };

  /** Persist the current draft. Wraps `createDraftVersion` so callers in
   *  this file remain ignorant of store wiring; outcome tracking happens in
   *  the surrounding handler. Returns the new draft version id, or throws. */
  const saveDraft = async (): Promise<string | null> => {
    if (!workflowId || !workflowType) return null;
    const store = useWorkflowBuilderStore.getState();
    const v = await createDraftVersion(workflowId, store.toDefinition());
    store.setMetadata({ workflowId, versionId: v.id, name, workflowType });
    store.hydrate(v.definition, { mode: 'rebase' });
    return v.id;
  };

  const refreshPublishState = async () => {
    if (!workflowId) return;
    try {
      const wf = await getWorkflow(workflowId);
      useWorkflowBuilderStore
        .getState()
        .setCurrentPublishedVersionId(wf.currentPublishedVersionId);
    } catch {
      // Non-fatal — header state is best-effort. Real failures still surface
      // via Save / Publish toasts elsewhere.
    }
  };

  const handleSave = async () => {
    if (!workflowId || !workflowType) return;
    const store = useWorkflowBuilderStore.getState();
    store.beginInFlight('saving');
    try {
      await saveDraft();
      store.finishSave({ status: 'ok', at: Date.now() });
      // Lifecycle-aware toast: a save against a workflow that already has
      // a published version doesn't ship the change to runtime — surface
      // that explicitly so the operator knows a Publish click is still
      // required for the new content to go live.
      const isPublishedAtSaveTime = Boolean(currentPublishedVersionId);
      notificationService.success(
        isPublishedAtSaveTime
          ? 'Saved (published version still live)'
          : 'Draft saved',
      );
    } catch (e) {
      const body = decodeApiError(e);
      store.finishSave({ status: 'fail', at: Date.now(), error: body });
      notificationService.error(summarizeApiErrorBody(body, 'Save failed'));
    }
  };

  const handlePublish = async () => {
    if (!workflowId) return;
    const store = useWorkflowBuilderStore.getState();
    setPublishError(null);
    store.beginInFlight('publishing');
    try {
      let target = versionId;
      // If the live state diverges from the committed snapshot, persist the
      // draft before publish — this matches the prior behaviour the user
      // expects from the Publish button (one click ships latest content).
      if (!target || hasUnsavedChanges) {
        target = await saveDraft();
      }
      if (!target) {
        const body: ApiErrorBody = {
          kind: 'message',
          message: 'No draft version to publish',
        };
        store.finishPublish({ status: 'fail', at: Date.now(), error: body });
        notificationService.error(body.message);
        return;
      }
      await publishVersion(workflowId, target);
      // Refresh publish state so Run Now becomes enabled and the header
      // status pill flips from Draft → Published. Without this the user
      // has to reload to see the change.
      await refreshPublishState();
      store.finishPublish({ status: 'ok', at: Date.now() });
      notificationService.success('Published');
    } catch (e) {
      const body = decodeApiError(e);
      store.finishPublish({ status: 'fail', at: Date.now(), error: body });
      // Field-level errors render in the dedicated panel below the bar so
      // every item is visible at once. Non-structured failures still toast
      // — a single-line message is enough for those.
      setPublishError(body);
      if (body.kind === 'fieldErrors') {
        notificationService.error(
          `Publish failed — ${body.items.length} validation issue${body.items.length === 1 ? '' : 's'}`,
        );
      } else {
        notificationService.error(summarizeApiErrorBody(body, 'Publish failed'));
      }
    }
  };

  const handleRun = async () => {
    if (!workflowId) return;
    try {
      const run = await fireManualRun(workflowId);
      notificationService.success(`Run started: ${run.id.slice(0, 8)}`);
      onRunStarted?.(run);
    } catch (e) {
      const body = decodeApiError(e);
      notificationService.error(summarizeApiErrorBody(body, 'Run failed'));
    }
  };

  const viewMode = useWorkflowBuilderStore((s) => s.viewMode);
  const setViewMode = useWorkflowBuilderStore((s) => s.setViewMode);
  const isPublished = Boolean(currentPublishedVersionId);
  const saveDisabled = !canSave(lifecycle, inFlight);
  const publishDisabled = !canPublish(lifecycle, inFlight);
  // Disable Run Now until the workflow has a published version. Backend will
  // reject otherwise with `workflow has no published version`; failing in the
  // UI gives a clearer affordance.
  const runDisabled = inFlight !== 'idle' || !isPublished;
  // Phase-14 follow-up — Test Run is a placeholder. Tooltip explains the
  // upcoming behaviour; flipping `testRunReady` to `true` enables the
  // button when the backend `dry_run` flag ships in a later phase.
  const testRunReady = false;
  const testRunDisabled = !testRunReady;
  const testRunTooltip =
    'Coming soon — runs without dispatching to real providers';

  const onEnterEdit = () => setViewMode('edit');

  // Phase-14 follow-up — Runs icon stays leftmost in both modes. The
  // button is disabled with a tooltip when zero runs exist; the TQ
  // hook's cache is shared with the inspector so opening the overlay is
  // an instant render once the list is loaded.
  const runsQuery = useWorkflowRuns(workflowId, { limit: 100 });
  const runs = runsQuery.data?.runs ?? [];
  const runsLoading = runsQuery.isLoading;
  const runsDisabled = runsLoading || runs.length === 0;
  const runsTooltip = runsLoading
    ? 'Loading runs…'
    : runs.length === 0
      ? 'No runs yet — click Run Now to create one'
      : 'Run inspector';
  const handleOpenRuns = () => {
    if (!onOpenRuns) return;
    // Default to the most recent run when opening from the header so
    // the operator lands on the live one without an extra click.
    onOpenRuns(runs[0]?.id ?? null);
  };

  return (
    <>
    <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleBack}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          aria-label="Back to campaigns"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Campaigns</span>
        </button>
        <span className="font-medium text-[var(--text-primary)]">
          {name || 'Untitled Workflow'}
        </span>
        <PublishStatusPill state={lifecycle} />
      </div>
      <div className="flex items-center gap-2">
        {/* Runs icon — leftmost, identical placement in both modes.
         *  Stable nav-to-data affordance, not a write action; keeps the
         *  primary save/publish surface clear of competing weight. */}
        <Button
          variant="secondary"
          onClick={handleOpenRuns}
          disabled={runsDisabled}
          title={runsTooltip}
          aria-label="Open run inspector"
        >
          <Timeline className="h-3.5 w-3.5" />
        </Button>
        {viewMode === 'view' ? (
          <ViewModeActions
            onEnterEdit={onEnterEdit}
            onRun={handleRun}
            runDisabled={runDisabled}
            isPublished={isPublished}
            testRunDisabled={testRunDisabled}
            testRunTooltip={testRunTooltip}
          />
        ) : (
          <EditModeActions
            lifecycle={lifecycle}
            saveDisabled={saveDisabled}
            publishDisabled={publishDisabled}
            runDisabled={runDisabled}
            isPublished={isPublished}
            testRunDisabled={testRunDisabled}
            testRunTooltip={testRunTooltip}
            onSave={handleSave}
            onPublish={handlePublish}
            onRun={handleRun}
          />
        )}
      </div>
    </div>
    {publishError ? (
      <div className="border-b border-[var(--border-subtle)] px-4 py-2">
        <PublishErrorPanel
          body={publishError}
          onDismiss={() => setPublishError(null)}
        />
      </div>
    ) : null}
    <ConfirmDialog
      isOpen={showLeaveConfirm}
      onClose={() => setShowLeaveConfirm(false)}
      onConfirm={() => {
        setShowLeaveConfirm(false);
        navigate(orchestrationRoutes.campaigns);
      }}
      title="Discard unsaved edits?"
      description="You have unsaved changes to this workflow. Leaving the builder will lose them — save the draft first if you want to keep them."
      confirmLabel="Leave"
      cancelLabel="Stay"
      variant="warning"
    />
    </>
  );
}

// ─── Header action regions ───────────────────────────────────────────────
//
// View mode shows three buttons: Run Now (icon + label), Test Run (disabled
// placeholder), Edit (primary). Edit mode collapses Save / Publish / Run
// Now / Test Run into one context-aware primary button + an overflow
// dropdown so the operator's eye lands on a single next-action.

interface ViewModeActionsProps {
  onEnterEdit(): void;
  onRun(): void;
  runDisabled: boolean;
  isPublished: boolean;
  testRunDisabled: boolean;
  testRunTooltip: string;
}

function ViewModeActions({
  onEnterEdit,
  onRun,
  runDisabled,
  isPublished,
  testRunDisabled,
  testRunTooltip,
}: ViewModeActionsProps) {
  // Order (per product call): Edit, Test Run, Run Now. Edit + Test Run
  // are icon-only — the tooltip carries the label so the operator's eye
  // lands on Run Now (primary).
  return (
    <>
      <Button
        variant="secondary"
        onClick={onEnterEdit}
        title="Edit workflow"
        aria-label="Edit workflow"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="secondary"
        disabled={testRunDisabled}
        title={`Test Run · ${testRunTooltip}`}
        aria-label="Test Run (coming soon)"
      >
        <FlaskConical className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="primary"
        onClick={onRun}
        disabled={runDisabled}
        title={
          runDisabled && !isPublished
            ? 'Publish a version before running'
            : 'Run Now'
        }
      >
        <Play className="mr-1 h-3.5 w-3.5" />
        Run Now
      </Button>
    </>
  );
}

interface EditModeActionsProps {
  lifecycle: LifecycleState;
  saveDisabled: boolean;
  publishDisabled: boolean;
  runDisabled: boolean;
  isPublished: boolean;
  testRunDisabled: boolean;
  testRunTooltip: string;
  onSave(): void;
  onPublish(): void;
  onRun(): void;
}

type PrimaryActionKind = 'save' | 'publish';

/** Decide which save action the primary button represents for a given
 *  lifecycle state. Failure states map to the action that failed (so the
 *  primary becomes "Retry Save" / "Retry Publish"). Clean-published has
 *  nothing to save and nothing new to publish — primary stays Save Draft
 *  but disabled, signalling "make a change first". */
function pickPrimary(state: LifecycleState): PrimaryActionKind {
  switch (state.kind) {
    case 'dirty-draft':
    case 'dirty-published-edits':
    case 'save-failed':
    case 'saving':
      return 'save';
    case 'clean-draft':
    case 'publish-failed':
    case 'publishing':
      return 'publish';
    case 'clean-published':
      // Nothing to save, but Save Draft is the natural button to keep
      // anchored — flips back to the active state the moment a content
      // change lands. Disabled with tooltip handled by the caller.
      return 'save';
  }
}

function primaryLabel(state: LifecycleState, kind: PrimaryActionKind): string {
  if (state.kind === 'saving') return 'Saving…';
  if (state.kind === 'publishing') return 'Publishing…';
  if (state.kind === 'save-failed') return 'Retry Save';
  if (state.kind === 'publish-failed') return 'Retry Publish';
  return kind === 'save' ? 'Save Draft' : 'Publish';
}

function EditModeActions({
  lifecycle,
  saveDisabled,
  publishDisabled,
  runDisabled,
  isPublished,
  testRunDisabled,
  testRunTooltip,
  onSave,
  onPublish,
  onRun,
}: EditModeActionsProps) {
  const primaryKind = pickPrimary(lifecycle);
  const primaryClick = primaryKind === 'save' ? onSave : onPublish;
  const primaryDisabled =
    primaryKind === 'save' ? saveDisabled : publishDisabled;
  const primaryTooltip =
    primaryKind === 'save' && lifecycle.kind === 'clean-published'
      ? 'No changes to save — edit a node first'
      : undefined;
  const PrimaryIcon = primaryKind === 'save' ? Save : Send;

  // Items in the "more" dropdown — the non-primary save action plus
  // Run Now and Test Run. Each row keeps its own enabled/tooltip state so
  // operators understand why something is greyed out.
  const items: Array<{
    key: string;
    icon: React.ReactNode;
    label: string;
    onClick?: () => void;
    disabled: boolean;
    title?: string;
  }> = [
    primaryKind === 'save'
      ? {
          key: 'publish',
          icon: <Send className="h-3.5 w-3.5" />,
          label: 'Publish',
          onClick: onPublish,
          disabled: publishDisabled,
        }
      : {
          key: 'save',
          icon: <Save className="h-3.5 w-3.5" />,
          label: 'Save Draft',
          onClick: onSave,
          disabled: saveDisabled,
        },
    {
      key: 'run',
      icon: <Play className="h-3.5 w-3.5" />,
      label: 'Run Now',
      onClick: onRun,
      disabled: runDisabled,
      title:
        runDisabled && !isPublished
          ? 'Publish a version before running'
          : undefined,
    },
    {
      key: 'test-run',
      icon: <FlaskConical className="h-3.5 w-3.5" />,
      label: 'Test Run',
      disabled: testRunDisabled,
      title: testRunTooltip,
    },
  ];

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            aria-label="More actions"
            title="More actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          className="z-[var(--z-popover,150)] min-w-[180px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shadow-lg"
        >
          <ul className="flex flex-col">
            {items.map((it) => (
              <li key={it.key}>
                <button
                  type="button"
                  onClick={it.onClick}
                  disabled={it.disabled}
                  title={it.title}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                    it.disabled
                      ? 'cursor-not-allowed text-[var(--text-muted)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
                  )}
                >
                  {it.icon}
                  <span>{it.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <Button
        variant="primary"
        onClick={primaryClick}
        disabled={primaryDisabled}
        title={primaryTooltip}
      >
        <PrimaryIcon className="mr-1 h-3.5 w-3.5" />
        {primaryLabel(lifecycle, primaryKind)}
      </Button>
    </>
  );
}

function PublishStatusPill({ state }: { state: LifecycleState }) {
  // Pill colour is derived from lifecycle kind so the copy and the colour
  // never disagree. Failure / in-flight states get distinct colours; the
  // dirty-vs-clean delta keeps the existing warning/success tokens.
  let bg: string;
  let fg: string;
  switch (state.kind) {
    case 'saving':
    case 'publishing':
      bg = 'var(--bg-tertiary)';
      fg = 'var(--text-secondary)';
      break;
    case 'save-failed':
    case 'publish-failed':
      bg = 'var(--surface-error-subtle, var(--surface-warning))';
      fg = 'var(--color-error)';
      break;
    case 'clean-published':
      bg = 'var(--surface-brand-subtle)';
      fg = 'var(--color-success)';
      break;
    case 'clean-draft':
    case 'dirty-draft':
    case 'dirty-published-edits':
    default:
      bg = 'var(--surface-warning)';
      fg = 'var(--color-warning)';
      break;
  }
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: bg, color: fg }}
    >
      {pillLabel(state)}
    </span>
  );
}
