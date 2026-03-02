import { useState, useEffect, useMemo } from 'react';
import { Plus, ChevronDown, BarChart3, PlayCircle, Star, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, Skeleton, LLMConfigSection } from '@/components/ui';
import { CreateEvaluatorOverlay } from './CreateEvaluatorOverlay';
import { EvaluatorCard } from './EvaluatorCard';
import { EvaluatorRegistryPicker } from './EvaluatorRegistryPicker';
import { RunAllOverlay } from '@/features/voiceRx/components/RunAllOverlay';
import { useEvaluatorsStore, LLM_PROVIDERS } from '@/stores';
import { useEvaluatorRunner } from '@/features/evals/hooks/useEvaluatorRunner';
import { evaluatorExecutor } from '@/services/evaluators/evaluatorExecutor';
import { notificationService } from '@/services/notifications';
import type { Listing, EvaluatorDefinition, LLMProvider } from '@/types';

interface EvaluatorsViewProps {
  listing: Listing;
  onUpdate?: (listing: Listing) => void;
}

export function EvaluatorsView({ listing, onUpdate: _onUpdate }: EvaluatorsViewProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvaluator, setEditingEvaluator] = useState<EvaluatorDefinition | undefined>();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showRegistryPicker, setShowRegistryPicker] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [evaluatorToDelete, setEvaluatorToDelete] = useState<string | null>(null);
  const [runAllOpen, setRunAllOpen] = useState(false);

  const [isSeeding, setIsSeeding] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider>(LLM_PROVIDERS[0].value);
  const [selectedModel, setSelectedModel] = useState('');

  const { evaluators, isLoaded, currentListingId, loadEvaluators, addEvaluator, updateEvaluator, deleteEvaluator, setGlobal, forkEvaluator, seedDefaults } = useEvaluatorsStore();

  // Pagination
  const PAGE_SIZE = 6;
  const totalPages = Math.ceil(evaluators.length / PAGE_SIZE);
  const isPaginated = evaluators.length > PAGE_SIZE;
  const paginatedEvaluators = useMemo(
    () => isPaginated ? evaluators.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) : evaluators,
    [evaluators, currentPage, isPaginated]
  );

  // Reset to page 1 when evaluator count changes (add/delete/seed)
  useEffect(() => { setCurrentPage(1); }, [evaluators.length]);

  const runner = useEvaluatorRunner({
    entityId: listing.id,
    appId: listing.appId,
    listingId: listing.id,
    provider: selectedProvider,
    execute: (evaluator, signal, onJobCreated) =>
      evaluatorExecutor.execute(evaluator, listing, { abortSignal: signal, onJobCreated, provider: selectedProvider, model: selectedModel }).then(() => {}),
  });

  useEffect(() => {
    if (!isLoaded || currentListingId !== listing.id) {
      loadEvaluators(listing.appId, listing.id);
    }
  }, [isLoaded, currentListingId, listing.appId, listing.id, loadEvaluators]);

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

  const handleEdit = (evaluator: EvaluatorDefinition) => {
    setEditingEvaluator(evaluator);
    setIsModalOpen(true);
  };

  const handleDelete = async (evaluatorId: string) => {
    setEvaluatorToDelete(evaluatorId);
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (evaluatorToDelete) {
      await deleteEvaluator(evaluatorToDelete);
      notificationService.success('Evaluator deleted');
      setDeleteConfirmOpen(false);
      setEvaluatorToDelete(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirmOpen(false);
    setEvaluatorToDelete(null);
  };

  const handleToggleHeader = async (evaluatorId: string, showInHeader: boolean) => {
    const evaluator = evaluators.find(e => e.id === evaluatorId);
    if (!evaluator) return;

    const updated: EvaluatorDefinition = {
      ...evaluator,
      showInHeader,
      updatedAt: new Date(),
    };

    await updateEvaluator(updated);
    notificationService.success(
      showInHeader ? 'Evaluator added to header' : 'Evaluator removed from header'
    );
  };

  const handleToggleGlobal = async (evaluatorId: string, isGlobal: boolean) => {
    await setGlobal(evaluatorId, isGlobal);
    notificationService.success(
      isGlobal
        ? 'Evaluator added to Registry'
        : 'Evaluator removed from Registry'
    );
  };

  const handleFork = async (sourceId: string) => {
    const forked = await forkEvaluator(sourceId, listing.id);
    notificationService.success(`Forked evaluator: ${forked.name}`);
  };

  const handleRunAll = (evaluatorIds: string[]) => {
    const evsToRun = evaluators.filter(e => evaluatorIds.includes(e.id));
    for (const ev of evsToRun) {
      runner.handleRun(ev); // fire-and-forget — cards show progress immediately
    }
  };

  const handleSeedDefaults = async () => {
    setIsSeeding(true);
    try {
      const seeded = await seedDefaults(listing.id);
      notificationService.success(`Added ${seeded.length} recommended evaluators`);
    } catch (err) {
      notificationService.error(
        err instanceof Error ? err.message : 'Failed to add recommended evaluators'
      );
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto flex flex-col p-6 space-y-4">
      {!isLoaded ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-10">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : evaluators.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={BarChart3}
            title="No evaluators yet"
            description="Add an evaluator to measure specific dimensions of quality like recall, factual integrity, or custom metrics."
            className="w-full max-w-md"
          >
          {listing.appId === 'voice-rx' && (
            <Button
              variant="secondary"
              onClick={handleSeedDefaults}
              disabled={isSeeding}
              isLoading={isSeeding}
              icon={Star}
              className="mb-2"
            >
              Add Recommended Evaluators (5)
            </Button>
          )}
          <div className="relative mt-1">
            <Button onClick={() => setShowAddMenu(!showAddMenu)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Evaluator
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>

            {showAddMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowAddMenu(false)} />
                <div className="absolute left-1/2 -translate-x-1/2 mt-1 w-48 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-lg z-20 py-1">
                  <button
                    onClick={() => { setIsModalOpen(true); setShowAddMenu(false); }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--interactive-secondary)] text-[var(--text-primary)]"
                  >
                    Create New
                  </button>
                  <button
                    onClick={() => { setShowRegistryPicker(true); setShowAddMenu(false); }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--interactive-secondary)] text-[var(--text-primary)]"
                  >
                    Add from Registry
                  </button>
                </div>
              </>
            )}
          </div>
          </EmptyState>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Evaluators ({evaluators.length})</h3>
            <div className="flex items-center gap-2">
              <LLMConfigSection
                provider={selectedProvider}
                onProviderChange={(p) => { setSelectedProvider(p); setSelectedModel(''); }}
                model={selectedModel}
                onModelChange={setSelectedModel}
                compact
              />
              <Button
                variant="secondary"
                onClick={() => setRunAllOpen(true)}
                icon={PlayCircle}
              >
                Run All
              </Button>
              <div className="relative">
              <Button onClick={() => setShowAddMenu(!showAddMenu)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Evaluator
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>

              {showAddMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowAddMenu(false)} />
                  <div className="absolute right-0 mt-1 w-48 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-lg z-20 py-1">
                    <button
                      onClick={() => { setIsModalOpen(true); setShowAddMenu(false); }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--interactive-secondary)] text-[var(--text-primary)]"
                    >
                      Create New
                    </button>
                    <button
                      onClick={() => { setShowRegistryPicker(true); setShowAddMenu(false); }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--interactive-secondary)] text-[var(--text-primary)]"
                    >
                      Add from Registry
                    </button>
                  </div>
                </>
              )}
              </div>
            </div>
          </div>

          {/* Grid of evaluator cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginatedEvaluators.map(evaluator => (
              <EvaluatorCard
                key={evaluator.id}
                evaluator={evaluator}
                listing={listing}
                latestRun={runner.getLatestRun(evaluator.id)}
                onRun={runner.handleRun}
                onCancel={runner.handleCancel}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onToggleHeader={handleToggleHeader}
                onToggleGlobal={handleToggleGlobal}
              />
            ))}
          </div>

          {/* Pagination */}
          {isPaginated && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-[var(--text-muted)]">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, evaluators.length)} of {evaluators.length}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={ChevronLeft}
                  iconOnly
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => p - 1)}
                />
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i + 1}
                    onClick={() => setCurrentPage(i + 1)}
                    className={`h-7 w-7 rounded-[6px] text-xs font-medium transition-colors ${
                      currentPage === i + 1
                        ? 'bg-[var(--interactive-primary)] text-[var(--text-on-color)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)]'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={ChevronRight}
                  iconOnly
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <CreateEvaluatorOverlay
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingEvaluator(undefined);
        }}
        onSave={handleSave}
        listing={listing}
        editEvaluator={editingEvaluator}
      />

      <EvaluatorRegistryPicker
        isOpen={showRegistryPicker}
        onClose={() => setShowRegistryPicker(false)}
        listing={listing}
        onFork={handleFork}
      />

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Delete Evaluator"
        description="Are you sure you want to delete this evaluator? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />

      <RunAllOverlay
        open={runAllOpen}
        onClose={() => setRunAllOpen(false)}
        onRun={handleRunAll}
      />
    </div>
  );
}
