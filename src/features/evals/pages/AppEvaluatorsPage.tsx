import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog, Skeleton } from '@/components/ui';
import { useCurrentAppConfig, useCurrentAppId, useCurrentAppMetadata } from '@/hooks';
import { CreateEvaluatorWizard, EvaluatorsTable } from '@/features/evals/components';
import { filterEvaluatorsByVisibility } from '@/services/api/evaluatorsApi';
import { notificationService } from '@/services/notifications';
import { useEvaluatorsStore } from '@/stores';
import { usePermission } from '@/utils/permissions';
import { evaluatorShowsInHeader, getEvaluatorMainMetricField, setEvaluatorHeaderVisibility } from '@/features/evals/utils/evaluatorMetadata';
import type {
  EvaluatorDefinition,
  EvaluatorVisibilityFilter,
  EvaluatorContext,
} from '@/types';

interface AppEvaluatorsPageProps {
  extraHeaderActions?: ReactNode;
  extraEmptyStateActions?: ReactNode;
  onOpenEvaluator?: (evaluator: EvaluatorDefinition) => void;
}

export function AppEvaluatorsPage({
  extraHeaderActions,
  extraEmptyStateActions,
  onOpenEvaluator,
}: AppEvaluatorsPageProps) {
  const appId = useCurrentAppId();
  const appConfig = useCurrentAppConfig();
  const appMetadata = useCurrentAppMetadata();
  const canCreate = usePermission('asset:create');
  const canEdit = usePermission('asset:edit');
  const canDelete = usePermission('asset:delete');
  const canShare = usePermission('asset:share');
  const [filter, setFilter] = useState<EvaluatorVisibilityFilter>('all');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editingEvaluator, setEditingEvaluator] = useState<EvaluatorDefinition | undefined>();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [evaluatorToDelete, setEvaluatorToDelete] = useState<EvaluatorDefinition | undefined>();
  const [isSeeding, setIsSeeding] = useState(false);

  const {
    evaluators,
    isLoaded,
    currentAppId,
    currentListingId,
    loadAppEvaluators,
    addEvaluator,
    updateEvaluator,
    deleteEvaluator,
    setVisibility,
    forkEvaluator,
    seedAppDefaults,
  } = useEvaluatorsStore();

  const supportsAppLevelSeedDefaults =
    appConfig.features.hasAdversarial || appConfig.features.hasRubricMode;

  useEffect(() => {
    if (!isLoaded || currentAppId !== appId || currentListingId !== null) {
      loadAppEvaluators(appId);
    }
  }, [appId, currentAppId, currentListingId, isLoaded, loadAppEvaluators]);

  const filteredEvaluators = useMemo(
    () => filterEvaluatorsByVisibility(evaluators, filter),
    [evaluators, filter],
  );
  const context: EvaluatorContext = useMemo(() => ({ appId }), [appId]);

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

  const handleSeedDefaults = async () => {
    if (!supportsAppLevelSeedDefaults) {
      return;
    }

    setIsSeeding(true);
    try {
      const seeded = await seedAppDefaults(appId);
      notificationService.success(`Added ${seeded.length} default evaluators`);
    } catch (error) {
      notificationService.error(
        error instanceof Error ? error.message : 'Failed to seed defaults',
      );
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {!isLoaded ? (
        <div className="grid grid-cols-1 gap-4 pt-6 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <EvaluatorsTable
          evaluators={filteredEvaluators}
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
          onSeedDefaults={supportsAppLevelSeedDefaults && canCreate ? handleSeedDefaults : undefined}
          onToggleHeader={handleToggleHeader}
          isSeeding={isSeeding}
          title="Evaluators"
          description={`Manage private and shared evaluators for ${appMetadata.name}.`}
          headerActions={extraHeaderActions}
          emptyStateActions={extraEmptyStateActions}
          onOpen={onOpenEvaluator}
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
          context={context}
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
    </div>
  );
}
