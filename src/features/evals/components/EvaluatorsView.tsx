import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlayCircle } from 'lucide-react';
import { ConfirmDialog, Button, Skeleton } from '@/components/ui';
import { useAppConfig } from '@/hooks';
import { useEvaluatorRunner } from '@/features/evals/hooks/useEvaluatorRunner';
import { RunAllOverlay, type RunAllSelection } from '@/features/voiceRx/components/RunAllOverlay';
import { evaluatorExecutor } from '@/services/evaluators/evaluatorExecutor';
import { filterEvaluatorsByVisibility } from '@/services/api/evaluatorsApi';
import { notificationService } from '@/services/notifications';
import { useEvaluatorsStore, LLM_PROVIDERS } from '@/stores';
import { usePermission } from '@/utils/permissions';
import { evaluatorShowsInHeader, getEvaluatorMainMetricField, setEvaluatorHeaderVisibility } from '@/features/evals/utils/evaluatorMetadata';
import { CreateEvaluatorWizard } from './CreateEvaluatorWizard';
import { EvaluatorsTable } from './EvaluatorsTable';
import type {
  EvalRun,
  Listing,
  EvaluatorDefinition,
  EvaluatorVisibilityFilter,
  LLMProvider,
} from '@/types';

interface EvaluatorsViewProps {
  listing: Listing;
  onUpdate?: (listing: Listing) => void;
}

export function EvaluatorsView({ listing }: EvaluatorsViewProps) {
  const appConfig = useAppConfig(listing.appId);
  const canCreate = usePermission('asset:create');
  const canEdit = usePermission('asset:edit');
  const canDelete = usePermission('asset:delete');
  const canShare = usePermission('asset:share');
  const canRun = usePermission('evaluation:run');
  const [filter, setFilter] = useState<EvaluatorVisibilityFilter>('all');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editingEvaluator, setEditingEvaluator] = useState<EvaluatorDefinition | undefined>();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [evaluatorToDelete, setEvaluatorToDelete] = useState<EvaluatorDefinition | undefined>();
  const [isSeeding, setIsSeeding] = useState(false);
  const [runAllOpen, setRunAllOpen] = useState(false);
  const [runSingleEvaluatorId, setRunSingleEvaluatorId] = useState<string | undefined>();
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider>(LLM_PROVIDERS[0].value);
  const [selectedModel, setSelectedModel] = useState('');
  const supportsListingSeedDefaults = appConfig.features.hasHumanReview;

  const providerRef = useRef(selectedProvider);
  const modelRef = useRef(selectedModel);
  providerRef.current = selectedProvider;
  modelRef.current = selectedModel;

  const {
    evaluators,
    isLoaded,
    currentListingId,
    loadEvaluators,
    addEvaluator,
    updateEvaluator,
    deleteEvaluator,
    setVisibility,
    forkEvaluator,
    seedDefaults,
  } = useEvaluatorsStore();

  const runner = useEvaluatorRunner({
    entityId: listing.id,
    appId: listing.appId,
    listingId: listing.id,
    provider: selectedProvider,
    execute: (evaluator, signal, onJobCreated) =>
      evaluatorExecutor.execute(evaluator, listing, {
        abortSignal: signal,
        onJobCreated,
        provider: providerRef.current,
        model: modelRef.current,
      }).then(() => {}),
  });

  useEffect(() => {
    if (!isLoaded || currentListingId !== listing.id) {
      loadEvaluators(listing.appId, listing.id);
    }
  }, [currentListingId, isLoaded, listing.appId, listing.id, loadEvaluators]);

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
    const forked = await forkEvaluator(evaluator.id, listing.id);
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

  const handleSeedDefaults = async () => {
    setIsSeeding(true);
    try {
      const seeded = await seedDefaults(listing.id);
      notificationService.success(`Added ${seeded.length} recommended evaluators`);
    } catch (error) {
      notificationService.error(
        error instanceof Error ? error.message : 'Failed to add recommended evaluators',
      );
    } finally {
      setIsSeeding(false);
    }
  };

  const headerActions = canRun && evaluators.length > 0 ? (
    <Button variant="secondary" onClick={() => { setRunSingleEvaluatorId(undefined); setRunAllOpen(true); }} icon={PlayCircle}>
      Run All
    </Button>
  ) : null;

  return (
    <div className="flex h-full flex-col space-y-4 overflow-y-auto p-6">
      {!isLoaded ? (
        <div className="grid grid-cols-1 gap-4 pt-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <EvaluatorsTable
          evaluators={filteredEvaluators}
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
          onRun={canRun ? handleSingleRun : undefined}
          onCancelRun={canRun ? runner.handleCancel : undefined}
          onSeedDefaults={supportsListingSeedDefaults && canCreate ? handleSeedDefaults : undefined}
          onToggleHeader={handleToggleHeader}
          isSeeding={isSeeding}
          title="Evaluators"
          description="Run private and shared evaluators against this listing without leaving the transcript workflow."
          headerActions={headerActions}
          canCreate={canCreate}
        />
      )}

      {isWizardOpen ? (
        <CreateEvaluatorWizard
          isOpen={isWizardOpen}
          onClose={() => {
            setIsWizardOpen(false);
            setEditingEvaluator(undefined);
          }}
          onSave={handleSave}
          context={{ appId: listing.appId, entityId: listing.id }}
          editEvaluator={editingEvaluator}
          listing={listing}
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
