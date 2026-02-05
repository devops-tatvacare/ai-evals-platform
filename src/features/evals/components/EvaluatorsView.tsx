import { useState, useEffect, useRef } from 'react';
import { Plus, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui';
import { CreateEvaluatorOverlay } from './CreateEvaluatorOverlay';
import { EvaluatorCard } from './EvaluatorCard';
import { EvaluatorRegistryPicker } from './EvaluatorRegistryPicker';
import { useEvaluatorsStore, useSettingsStore } from '@/stores';
import { useTaskQueueStore } from '@/stores';
import { evaluatorExecutor } from '@/services/evaluators/evaluatorExecutor';
import { notificationService } from '@/services/notifications';
import { listingsRepository } from '@/services/storage';
import type { Listing, EvaluatorDefinition, EvaluatorRun } from '@/types';

interface EvaluatorsViewProps {
  listing: Listing;
  onUpdate?: (listing: Listing) => void;
}

export function EvaluatorsView({ listing, onUpdate }: EvaluatorsViewProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvaluator, setEditingEvaluator] = useState<EvaluatorDefinition | undefined>();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showRegistryPicker, setShowRegistryPicker] = useState(false);
  
  // Track abort controllers for running evaluators
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  
  const { evaluators, isLoaded, currentListingId, loadEvaluators, addEvaluator, updateEvaluator, deleteEvaluator, setGlobal, forkEvaluator } = useEvaluatorsStore();
  const { addTask, completeTask } = useTaskQueueStore.getState();
  
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
  
  const handleRun = async (evaluator: EvaluatorDefinition) => {
    console.log('[EvaluatorsView] handleRun started', { 
      evaluatorId: evaluator.id, 
      evaluatorName: evaluator.name,
      listingId: listing.id 
    });

    // 1. Check API key before starting
    const { llm } = useSettingsStore.getState();
    if (!llm.apiKey) {
      notificationService.error('Please configure your API key in Settings', 'API Key Required');
      return;
    }

    // 2. Create a 'processing' run immediately
    const processingRun: EvaluatorRun = {
      id: crypto.randomUUID(),
      evaluatorId: evaluator.id,
      listingId: listing.id,
      status: 'processing',
      startedAt: new Date(),
    };
    
    console.log('[EvaluatorsView] Created processing run', { runId: processingRun.id });
    
    // 3. Reload fresh data from DB before updating
    let currentListing = await listingsRepository.getById(listing.appId, listing.id);
    if (!currentListing) {
      console.error('[EvaluatorsView] Listing not found in DB', { listingId: listing.id });
      notificationService.error('Listing not found', 'Error');
      return;
    }
    
    const updatedRuns = [...(currentListing.evaluatorRuns || [])];
    const existingIndex = updatedRuns.findIndex(r => r.evaluatorId === evaluator.id);
    
    if (existingIndex >= 0) {
      updatedRuns[existingIndex] = processingRun;
    } else {
      updatedRuns.push(processingRun);
    }
    
    console.log('[EvaluatorsView] Saving processing state to DB', { 
      totalRuns: updatedRuns.length,
      existingIndex 
    });
    
    await listingsRepository.update(listing.appId, listing.id, {
      evaluatorRuns: updatedRuns,
    });
    
    // Reload and trigger UI update to show loading state
    let freshListing = await listingsRepository.getById(listing.appId, listing.id);
    if (freshListing && onUpdate) {
      console.log('[EvaluatorsView] Triggering onUpdate with processing state');
      onUpdate(freshListing);
    }
    
    // Show loading notification
    const taskId = addTask({
      type: 'evaluator',
      listingId: listing.id,
    });
    
    notificationService.info(`Running ${evaluator.name}...`, 'Evaluator Started');
    
    // Create abort controller for this evaluator
    const abortController = new AbortController();
    abortControllersRef.current.set(evaluator.id, abortController);
    
    // 4. Execute evaluator (API call)
    try {
      console.log('[EvaluatorsView] Calling evaluatorExecutor.execute()...');
      const completedRun = await evaluatorExecutor.execute(evaluator, listing, {
        abortSignal: abortController.signal,
      });
      
      // Clean up abort controller
      abortControllersRef.current.delete(evaluator.id);
      
      console.log('[EvaluatorsView] Evaluator execution completed', {
        status: completedRun.status,
        hasOutput: !!completedRun.output,
        outputKeys: completedRun.output ? Object.keys(completedRun.output) : [],
        error: completedRun.error
      });
      
      // 5. CRITICAL: Reload fresh data from DB before updating (avoid stale closure data)
      currentListing = await listingsRepository.getById(listing.appId, listing.id);
      if (!currentListing) {
        throw new Error('Listing disappeared from DB');
      }
      
      console.log('[EvaluatorsView] Current runs in DB before final update:', 
        currentListing.evaluatorRuns?.length
      );
      
      const finalRuns = [...(currentListing.evaluatorRuns || [])];
      const finalIndex = finalRuns.findIndex(r => r.evaluatorId === evaluator.id);
      
      if (finalIndex >= 0) {
        finalRuns[finalIndex] = completedRun;
      } else {
        finalRuns.push(completedRun);
      }
      
      console.log('[EvaluatorsView] Updating DB with final result', {
        finalIndex,
        totalRuns: finalRuns.length,
        runStatus: completedRun.status
      });
      
      // Separate try-catch for DB operations
      try {
        await listingsRepository.update(listing.appId, listing.id, {
          evaluatorRuns: finalRuns,
        });
        
        console.log('[EvaluatorsView] DB update succeeded');
        
        // Verify the update
        const verifiedListing = await listingsRepository.getById(listing.appId, listing.id);
        console.log('[EvaluatorsView] Verified runs in DB after update:', 
          verifiedListing?.evaluatorRuns?.length
        );
        
        // Trigger UI update
        if (verifiedListing && onUpdate) {
          console.log('[EvaluatorsView] Triggering onUpdate with final result');
          onUpdate(verifiedListing);
        }
        
      } catch (dbError) {
        console.error('[EvaluatorsView] DB update failed but API succeeded!', dbError);
        notificationService.error(
          'Results received but failed to save. Please retry.',
          'Storage Error'
        );
        completeTask(taskId, 'error');
        return;
      }
      
      completeTask(taskId, completedRun.status === 'completed' ? 'success' : 'error');
      
      if (completedRun.status === 'completed') {
        console.log('[EvaluatorsView] Success notification');
        notificationService.success(`${evaluator.name} completed successfully`, 'Evaluator Complete');
      } else {
        console.log('[EvaluatorsView] Evaluator completed with error status');
        notificationService.error(
          completedRun.error || 'Evaluator failed',
          `${evaluator.name} Failed`
        );
      }
      
    } catch (error) {
      // Handle API execution error
      console.error('[EvaluatorsView] API execution failed', {
        error: error instanceof Error ? error.message : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Clean up abort controller
      abortControllersRef.current.delete(evaluator.id);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      const failedRun: EvaluatorRun = {
        ...processingRun,
        status: 'failed',
        error: errorMessage,
        completedAt: new Date(),
      };
      
      // Reload fresh data before updating
      currentListing = await listingsRepository.getById(listing.appId, listing.id);
      if (!currentListing) {
        console.error('[EvaluatorsView] Listing disappeared during error handling');
        completeTask(taskId, 'error');
        return;
      }
      
      const errorRuns = [...(currentListing.evaluatorRuns || [])];
      const errorIndex = errorRuns.findIndex(r => r.evaluatorId === evaluator.id);
      
      if (errorIndex >= 0) {
        errorRuns[errorIndex] = failedRun;
      } else {
        errorRuns.push(failedRun);
      }
      
      console.log('[EvaluatorsView] Saving error state to DB');
      
      await listingsRepository.update(listing.appId, listing.id, {
        evaluatorRuns: errorRuns,
      });
      
      freshListing = await listingsRepository.getById(listing.appId, listing.id);
      if (freshListing && onUpdate) {
        console.log('[EvaluatorsView] Triggering onUpdate with error state');
        onUpdate(freshListing);
      }
      
      completeTask(taskId, 'error');
      
      // Show detailed error notification
      if (errorMessage.toLowerCase().includes('network') || errorMessage.toLowerCase().includes('fetch')) {
        notificationService.error(
          'Please check your internet connection and API key configuration',
          'Network Error'
        );
      } else if (errorMessage.toLowerCase().includes('api key') || errorMessage.toLowerCase().includes('unauthorized')) {
        notificationService.error(
          'Please verify your API key in Settings',
          'Authentication Error'
        );
      } else {
        notificationService.error(errorMessage, `${evaluator.name} Failed`);
      }
    }
  };
  
  const handleEdit = (evaluator: EvaluatorDefinition) => {
    setEditingEvaluator(evaluator);
    setIsModalOpen(true);
  };
  
  const handleCancel = async (evaluatorId: string) => {
    console.log('[EvaluatorsView] handleCancel called', { evaluatorId });
    
    const abortController = abortControllersRef.current.get(evaluatorId);
    if (abortController) {
      abortController.abort();
      abortControllersRef.current.delete(evaluatorId);
      notificationService.info('Evaluator cancelled');
    }
  };
  
  const handleDelete = async (evaluatorId: string) => {
    if (confirm('Are you sure you want to delete this evaluator?')) {
      await deleteEvaluator(evaluatorId);
      notificationService.success('Evaluator deleted');
    }
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
  
  const getLatestRun = (evaluatorId: string): EvaluatorRun | undefined => {
    return listing.evaluatorRuns?.find(r => r.evaluatorId === evaluatorId);
  };
  
  return (
    <div className="space-y-4 p-6">
      {evaluators.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-4 text-muted-foreground">
            <Plus className="h-12 w-12 mx-auto mb-2" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No Evaluators Yet</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            Add an evaluator to measure specific dimensions of quality like recall, 
            factual integrity, or custom metrics.
          </p>
          <div className="relative">
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
        </div>
      ) : (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Evaluators ({evaluators.length})</h3>
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
          
          {/* Grid of evaluator cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {evaluators.map(evaluator => (
              <EvaluatorCard
                key={evaluator.id}
                evaluator={evaluator}
                listing={listing}
                latestRun={getLatestRun(evaluator.id)}
                onRun={handleRun}
                onCancel={handleCancel}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onToggleHeader={handleToggleHeader}
                onToggleGlobal={handleToggleGlobal}
              />
            ))}
          </div>
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
    </div>
  );
}
