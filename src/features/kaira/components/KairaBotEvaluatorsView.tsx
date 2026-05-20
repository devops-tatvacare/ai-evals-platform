import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlayCircle } from 'lucide-react';
import { Alert, Button, ConfirmDialog } from '@/components/ui';


import { CreateEvaluatorWizard, EvaluatorsTable } from '@/features/evals/components';
import { useEvaluatorRunner } from '@/features/evals/hooks/useEvaluatorRunner';
import { RunAllOverlay, type RunAllSelection } from '@/features/voiceRx/components/RunAllOverlay';
import { evaluatorExecutor } from '@/services/evaluators/evaluatorExecutor';
import { filterEvaluatorsByVisibility } from '@/services/api/evaluatorsApi';


import { notificationService } from '@/services/notifications';
import { useEvaluatorsStore } from '@/stores';
import { useAuthStore } from '@/stores/authStore';
import { usePermission } from '@/utils/permissions';
import { evaluatorShowsInHeader, getEvaluatorMainMetricField, setEvaluatorHeaderVisibility } from '@/features/evals/utils/evaluatorMetadata';
import type {
  EvalRun,
  EvaluatorDefinition,
  EvaluatorVisibilityFilter,
  KairaChatMessage,
  KairaChatSession,
} from '@/types';
import type { LLMProvider } from '@/services/api/aiSettingsApi';

interface KairaBotEvaluatorsViewProps {
  session: KairaChatSession | null;
  messages: KairaChatMessage[];
}

export function KairaBotEvaluatorsView({ session }: KairaBotEvaluatorsViewProps) {
  const appId = 'kaira-bot';
  const canCreate = usePermission('asset:create');
  const canEdit = usePermission('asset:edit');
  const canDelete = usePermission('asset:delete');
  const canShare = usePermission('asset:share');
  const canRun = usePermission('evaluation:run');
  const isOwner = useAuthStore((state) => state.user?.isOwner ?? false);
  const [filter, setFilter] = useState<EvaluatorVisibilityFilter>('all');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editingEvaluator, setEditingEvaluator] = useState<EvaluatorDefinition | undefined>();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [evaluatorToDelete, setEvaluatorToDelete] = useState<EvaluatorDefinition | undefined>();
  const [isSeeding, setIsSeeding] = useState(false);
  const [runAllOpen, setRunAllOpen] = useState(false);
  const [runSingleEvaluatorId, setRunSingleEvaluatorId] = useState<string | undefined>();
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider | ''>('');
  const [selectedModel, setSelectedModel] = useState('');

  const providerRef = useRef(selectedProvider);
  const modelRef = useRef(selectedModel);
  providerRef.current = selectedProvider;
  modelRef.current = selectedModel;

  const {
    evaluators,
    isLoaded,
    currentAppId,
    loadAppEvaluators,
    addEvaluator,
    updateEvaluator,
    deleteEvaluator,
    setVisibility,
    forkEvaluator,
    seedAppDefaults,
  } = useEvaluatorsStore();

  useEffect(() => {
    if (!isLoaded || currentAppId !== appId) {
      loadAppEvaluators(appId);
    }
  }, [appId, currentAppId, isLoaded, loadAppEvaluators]);

  const runner = useEvaluatorRunner({
    entityId: session?.id ?? '',
    appId,
    sessionId: session?.id,
    provider: selectedProvider,
    execute: (evaluator, signal, onJobCreated) => {
      if (!session) {
        throw new Error('No active session');
      }
      return evaluatorExecutor.executeForSession(evaluator, session, {
        abortSignal: signal,
        onJobCreated,
        provider: providerRef.current,
        model: modelRef.current,
      }).then(() => {});
    },
  });

  const filteredEvaluators = useMemo(
    () => filterEvaluatorsByVisibility(evaluators, filter),
    [evaluators, filter],
  );
  const latestRunsByEvaluatorId = useMemo(
    () => evaluators.reduce<Record<string, EvalRun | undefined>>((items, evaluator) => {
      items[evaluator.id] = runner.getLatestRun(evaluator.id);
      return items;
    }, {}),
    [evaluators, runner],
  );

  const handleSave = async (evaluator: EvaluatorDefinition) => {
    if (editingEvaluator) {
      await updateEvaluator(evaluator);
      notificationService.success('Evaluator updated');
    } else {
      await addEvaluator(evaluator);
      notificationService.success('Evaluator created');
    }
    setEditingEvaluator(undefined);
  };

  const handleVisibilityChange = async (evaluator: EvaluatorDefinition) => {
    const nextVisibility = evaluator.visibility === 'shared' ? 'private' : 'shared';
    await setVisibility(evaluator.id, nextVisibility);
    notificationService.success(
      nextVisibility === 'shared' ? 'Evaluator shared' : 'Evaluator made private',
    );
  };

  const handleToggleHeader = async (evaluator: EvaluatorDefinition) => {
    if (!getEvaluatorMainMetricField(evaluator)) {
      notificationService.error('Select a main metric before changing header visibility');
      return;
    }

    const nextShowInHeader = !evaluatorShowsInHeader(evaluator);
    await updateEvaluator({
      ...evaluator,
      outputSchema: setEvaluatorHeaderVisibility(evaluator.outputSchema, nextShowInHeader),
      updatedAt: new Date(),
    });
    notificationService.success(
      nextShowInHeader ? 'Evaluator added to header' : 'Evaluator removed from header',
    );
  };

  const handleFork = async (evaluator: EvaluatorDefinition) => {
    const forked = await forkEvaluator(evaluator.id);
    notificationService.success(`Forked evaluator: ${forked.name}`);
  };

  const handleConfirmDelete = async () => {
    if (!evaluatorToDelete) {
      return;
    }

    await deleteEvaluator(evaluatorToDelete.id);
    notificationService.success('Evaluator deleted');
    setDeleteConfirmOpen(false);
    setEvaluatorToDelete(undefined);
  };

  const handleSingleRun = useCallback((evaluator: EvaluatorDefinition) => {
    setRunSingleEvaluatorId(evaluator.id);
    setRunAllOpen(true);
  }, []);

  const handleRunAll = ({ evaluatorIds, provider, model }: RunAllSelection) => {
    if (!session) {
      notificationService.error('Start a chat session before running evaluators', 'No Session');
      return;
    }

    setRunSingleEvaluatorId(undefined);
    setSelectedProvider(provider);
    setSelectedModel(model);
    providerRef.current = provider;
    modelRef.current = model;

    evaluators
      .filter((evaluator) => evaluatorIds.includes(evaluator.id))
      .forEach((evaluator) => {
        void runner.handleRun(evaluator);
      });
  };

  const handleRestoreDefaults = async () => {
    setIsSeeding(true);
    try {
      const seeded = await seedAppDefaults(appId);
      if (seeded.length > 0) {
        notificationService.success(`Restored ${seeded.length} missing default evaluators`);
      } else {
        notificationService.info('All default evaluators are already present');
      }
    } catch (error) {
      notificationService.error(
        error instanceof Error ? error.message : 'Failed to restore defaults',
      );
    } finally {
      setIsSeeding(false);
    }
  };

  const headerActions = canRun && session && evaluators.length > 0 ? (
    <Button
      variant="secondary"
      icon={PlayCircle}
      iconOnly
      onClick={() => { setRunSingleEvaluatorId(undefined); setRunAllOpen(true); }}
      aria-label="Run all"
      title="Run all"
    >
      Run All
    </Button>
  ) : null;

  return (
    <div className="flex min-h-full flex-col space-y-4 overflow-y-auto p-6">
      {!session ? (
        <Alert variant="warning">
          Start a chat session first, then run evaluators against the conversation.
        </Alert>
      ) : null}

      <EvaluatorsTable
        evaluators={filteredEvaluators}
        loading={!isLoaded}
        latestRunsByEvaluatorId={latestRunsByEvaluatorId}
        filter={filter}
        onFilterChange={setFilter}
        onCreate={() => {
          setEditingEvaluator(undefined);
          setIsWizardOpen(true);
        }}
        onEdit={canEdit ? (evaluator) => {
          setEditingEvaluator(evaluator);
          setIsWizardOpen(true);
        } : undefined}
        onFork={canCreate ? handleFork : undefined}
        onDelete={canDelete ? (evaluator) => {
          setEvaluatorToDelete(evaluator);
          setDeleteConfirmOpen(true);
        } : undefined}
        onVisibilityChange={canShare ? handleVisibilityChange : undefined}
        onRun={canRun && session ? handleSingleRun : undefined}
        onCancelRun={canRun && session ? runner.handleCancel : undefined}
        onRestoreDefaults={isOwner ? handleRestoreDefaults : undefined}
        onToggleHeader={handleToggleHeader}
        isRestoringDefaults={isSeeding}
        headerActions={headerActions}
        canCreate={canCreate}
        canEditOwned={canEdit}
        canDeleteOwned={canDelete}
        canShareOwned={canShare}
        canManageSeededDefaults={isOwner}
      />

      {isWizardOpen ? (
        <CreateEvaluatorWizard
          isOpen={isWizardOpen}
          onClose={() => {
            setIsWizardOpen(false);
            setEditingEvaluator(undefined);
          }}
          onSave={handleSave}
          context={{ appId }}
          editEvaluator={editingEvaluator}
        />
      ) : null}

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setEvaluatorToDelete(undefined);
        }}
        onConfirm={handleConfirmDelete}
        title="Delete Evaluator"
        description="Are you sure you want to delete this evaluator? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />

      <RunAllOverlay
        open={runAllOpen}
        onClose={() => {
          setRunAllOpen(false);
          setRunSingleEvaluatorId(undefined);
        }}
        onRun={handleRunAll}
        initialSelectedIds={runSingleEvaluatorId ? [runSingleEvaluatorId] : undefined}
      />
    </div>
  );
}
