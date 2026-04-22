import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button, ConfirmDialog, PageSurface } from '@/components/ui';
import { useCurrentAppConfig, useCurrentAppId, useCurrentAppMetadata } from '@/hooks';
import { CreateEvaluatorWizard, EvaluatorsTable } from '@/features/evals/components';
import { filterEvaluatorsByVisibility } from '@/services/api/evaluatorsApi';
import { notificationService } from '@/services/notifications';
import { useEvaluatorsStore } from '@/stores';
import { useAuthStore } from '@/stores/authStore';
import { usePermission } from '@/utils/permissions';
import { evaluatorShowsInHeader, getEvaluatorMainMetricField, setEvaluatorHeaderVisibility } from '@/features/evals/utils/evaluatorMetadata';
import type {
  EvaluatorDefinition,
  EvaluatorVisibilityFilter,
  EvaluatorContext,
} from '@/types';

interface AppEvaluatorsPageSurface {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
}

interface AppEvaluatorsPageProps {
  extraHeaderActions?: ReactNode;
  extraEmptyStateActions?: ReactNode;
  onOpenEvaluator?: (evaluator: EvaluatorDefinition) => void;
  /**
   * When provided, the page renders inside the unified PageSurface shell with
   * the given icon/title, and the Create / Restore buttons move into the
   * PageSurface header actions slot. When omitted, the page falls back to the
   * legacy in-table header (other apps). Used by the Kaira prototype.
   */
  surface?: AppEvaluatorsPageSurface;
}

export function AppEvaluatorsPage({
  extraHeaderActions,
  extraEmptyStateActions,
  onOpenEvaluator,
  surface,
}: AppEvaluatorsPageProps) {
  const appId = useCurrentAppId();
  const appConfig = useCurrentAppConfig();
  const appMetadata = useCurrentAppMetadata();
  const canCreate = usePermission('asset:create');
  const canEdit = usePermission('asset:edit');
  const canDelete = usePermission('asset:delete');
  const canShare = usePermission('asset:share');
  const isOwner = useAuthStore((state) => state.user?.isOwner ?? false);
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

  const handleRestoreDefaults = async () => {
    if (!supportsAppLevelSeedDefaults) {
      return;
    }

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

  const handleOpenCreate = () => {
    setEditingEvaluator(undefined);
    setIsWizardOpen(true);
  };

  const showRestore = supportsAppLevelSeedDefaults && isOwner;

  const surfaceActions = surface ? (
    <>
      {showRestore && (
        <Button variant="secondary" onClick={handleRestoreDefaults} isLoading={isSeeding}>
          Restore Defaults
        </Button>
      )}
      {canCreate && <Button onClick={handleOpenCreate}>Create Evaluator</Button>}
    </>
  ) : null;

  const table = (
    <EvaluatorsTable
      evaluators={filteredEvaluators}
      loading={!isLoaded}
      filter={filter}
      onFilterChange={setFilter}
      onCreate={handleOpenCreate}
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
      onRestoreDefaults={showRestore ? handleRestoreDefaults : undefined}
      onToggleHeader={handleToggleHeader}
      isRestoringDefaults={isSeeding}
      title="Evaluators"
      description={`Manage private and shared evaluators for ${appMetadata.name}.`}
      headerActions={extraHeaderActions}
      emptyStateActions={extraEmptyStateActions}
      hideHeader={Boolean(surface)}
      onOpen={onOpenEvaluator}
      canCreate={canCreate}
      canEditOwned={canEdit}
      canDeleteOwned={canDelete}
      canShareOwned={canShare}
      canManageSeededDefaults={isOwner}
    />
  );

  const dialogs = (
    <>
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
    </>
  );

  if (surface) {
    return (
      <PageSurface
        icon={surface.icon}
        title={surface.title}
        subtitle={surface.subtitle}
        actions={surfaceActions}
      >
        {table}
        {dialogs}
      </PageSurface>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {table}
      {dialogs}
    </div>
  );
}
