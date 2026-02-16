import { useParams, useSearchParams } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { Tabs, Skeleton, SplitButton, Alert } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui';
import { FeatureErrorBoundary } from '@/components/feedback';
import { TranscriptView } from '@/features/transcript';
import { StructuredOutputsView } from '@/features/structured-outputs';
import { EvalsView, MetricsBar, EvaluationOverlay, EvaluatorsView, EvaluatorMetrics } from '@/features/evals';
import { useListingMetrics, useAIEvaluation, type EvaluationConfig } from '@/features/evals/hooks';
import { ExportDropdown } from '@/features/export';
import { OutputTab } from '@/features/voiceRx';
import { useApiFetch, useTranscriptAdd } from '@/features/upload';
import { listingsRepository, filesRepository } from '@/services/storage';
import { useListingsStore, useAppStore, useEvaluatorsStore } from '@/stores';
import { useListingOperations } from './hooks';
import type { Listing } from '@/types';
import { Cloud, RefreshCw, FileText, Play, Clock } from 'lucide-react';

export function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [listing, setListing] = useState<Listing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRefetchConfirm, setShowRefetchConfirm] = useState(false);
  const appId = useAppStore((state) => state.currentApp);
  const setSelectedId = useListingsStore((state) => state.setSelectedId);
  
  // Subscribe to evaluators store to get fresh data
  const evaluators = useEvaluatorsStore((state) => state.evaluators);
  
  const { fetchFromApi, refetchFromApi, isFetching } = useApiFetch();
  const { addTranscriptToListing, getUpdatedListing, isAdding: isAddingTranscript } = useTranscriptAdd();
  const { evaluate, cancel: cancelEvaluation } = useAIEvaluation();
  
  // Track all operations for this listing
  const operations = useListingOperations(listing, { isFetching, isAddingTranscript });
  
  // Evaluation modal state
  const [isEvalModalOpen, setIsEvalModalOpen] = useState(false);
  const [evalVariant, setEvalVariant] = useState<'segments' | 'regular' | undefined>();
  const [hasAudioBlob, setHasAudioBlob] = useState(false);

  // Load listing from API or fallback to store
  useEffect(() => {
    let cancelled = false;

    async function loadListing() {
      if (!id) return;
      
      setError(null);
      
      try {
        // First try to get from DB
        let data: Listing | undefined;
        try {
          data = await listingsRepository.getById(appId, id);
        } catch {
          // Not found in DB, will try in-memory store
        }

        // If not in DB, check the in-memory store (for newly created listings)
        if (!data) {
          const storeListings = useListingsStore.getState().listings[appId] || [];
          data = storeListings.find(l => l.id === id);
        }

        if (cancelled) return;

        if (data) {
          setListing(data);
          setSelectedId(id);
        } else {
          setError('Listing not found');
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load listing:', err);
        setError('Failed to load listing');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadListing();
    return () => { cancelled = true; };
  }, [id, appId, setSelectedId]);

  const handleListingUpdate = useCallback(async (updatedListing: Listing) => {
    // Update local state immediately for responsive UI
    setListing(updatedListing);
    
    // Also reload from DB to ensure we have the latest persisted data
    try {
      const freshListing = await listingsRepository.getById(appId, updatedListing.id);
      if (freshListing) {
        setListing(freshListing);
      }
    } catch (err) {
      console.error('Failed to reload listing after update:', err);
    }
  }, [appId]);

  const handleFetchFromApi = async () => {
    if (!listing) return;
    const updated = await fetchFromApi(listing);
    if (updated) {
      setListing(updated);
    }
  };

  const handleRefetchFromApi = async () => {
    if (!listing) return;
    const updated = await refetchFromApi(listing);
    if (updated) {
      setListing(updated);
    }
    setShowRefetchConfirm(false);
  };

  const handleAddTranscript = async () => {
    if (!listing) return;
    const result = await addTranscriptToListing(listing);
    if (result) {
      // Reload updated listing from DB
      const updated = await getUpdatedListing(listing.id);
      if (updated) {
        setListing(updated);
      }
    }
  };

  // Check if audio blob is available for evaluation
  useEffect(() => {
    async function checkAudio() {
      if (listing?.audioFile?.id) {
        const file = await filesRepository.getById(listing.audioFile.id);
        setHasAudioBlob(!!file);
      } else {
        setHasAudioBlob(false);
      }
    }
    checkAudio();
  }, [listing?.audioFile?.id]);

  // Destructure operation flags for cleaner code
  const { isAnyOperationInProgress, isEvaluating } = operations;

  const handleOpenEvalModal = useCallback((variant?: 'segments' | 'regular') => {
    setEvalVariant(variant);
    setIsEvalModalOpen(true);
  }, []);

  const handleCloseEvalModal = useCallback(() => {
    setIsEvalModalOpen(false);
    setEvalVariant(undefined);
  }, []);

  const handleStartEvaluation = useCallback(async (config: EvaluationConfig) => {
    if (!listing) return;
    
    // Close modal immediately - evaluation runs in background
    setIsEvalModalOpen(false);
    
    // Switch to evals tab to show progress
    setSearchParams({ tab: 'evals' });
    
    const result = await evaluate(listing, config);
    if (result) {
      setListing({
        ...listing,
        aiEval: result,
      });
    }
  }, [evaluate, listing, setSearchParams]);

  // Get active tab from URL or default to 'transcript'
  const activeTab = searchParams.get('tab') || 'transcript';
  
  const handleTabChange = (tabId: string) => {
    setSearchParams({ tab: tabId });
  };

  // Hook must be called before any early returns
  const metrics = useListingMetrics(listing);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !listing) {
    return (
      <Alert variant="error">
        {error || 'Listing not found'}
      </Alert>
    );
  }

  const hasApiResponse = !!listing.apiResponse;
  const hasTranscript = !!listing.transcript;
  const hasEvalData = hasTranscript || hasApiResponse;

  // Build tabs with progressive disclosure based on sourceType AND data availability
  const tabs = [];

  // Transcript tab - always visible (zero state guides user)
  tabs.push({
    id: 'transcript',
    label: 'Transcript',
    content: <TranscriptView listing={listing} />,
  });

  // Structured Output tab (singular) - API flow only, after API call completes
  if (listing.sourceType === 'api' && hasApiResponse) {
    tabs.push({
      id: 'structured-output',
      label: 'Structured Output',
      content: <OutputTab listing={listing} />,
    });
  }

  // Structured Outputs tab (plural) - Upload flow only, after transcript is added
  if (listing.sourceType === 'upload' && hasTranscript) {
    tabs.push({
      id: 'structured-outputs',
      label: 'Structured Outputs',
      content: <StructuredOutputsView listing={listing} onUpdate={handleListingUpdate} />,
    });
  }

  // Evaluators tab - Same disclosure rule as Evals tab (show after transcript available)
  if (hasTranscript) {
    tabs.push({
      id: 'evaluators',
      label: 'Evaluators',
      content: <EvaluatorsView listing={listing} onUpdate={handleListingUpdate} />,
    });
  }

  // Full Evaluations tab - ONLY show when evaluation has been run (not before) - appears at the end
  if (listing.aiEval || isEvaluating) {
    tabs.push({
      id: 'evals',
      label: 'Full Evaluations',
      content: <EvalsView listing={listing} onUpdate={handleListingUpdate} hideRerunButton />,
    });
  }

  // Determine if evaluation is possible (need transcript or API response)
  const canEvaluate = hasEvalData && hasAudioBlob;
  const hasExistingEval = !!listing.aiEval;

  return (
    <FeatureErrorBoundary featureName="Listing">
      <div className="flex flex-col h-[calc(100vh-var(--header-height))]">
        {/* Sticky header */}
        <div className="shrink-0 pb-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">
              {listing.title}
            </h1>
            <div className="flex items-center gap-2">
              {/* Data Source split button - shows based on sourceType and state */}
              {listing.sourceType === 'pending' && (
                <SplitButton
                  primaryLabel="Fetch from API"
                  primaryIcon={<Cloud className="h-4 w-4" />}
                  primaryAction={handleFetchFromApi}
                  isLoading={isFetching}
                  disabled={isAnyOperationInProgress}
                  size="sm"
                  variant="secondary"
                  dropdownItems={[
                    {
                      label: 'Add Transcripts',
                      icon: <FileText className="h-4 w-4" />,
                      action: handleAddTranscript,
                      description: 'Upload .txt or .json transcript file',
                      disabled: isAnyOperationInProgress,
                    },
                  ]}
                />
              )}

              {/* API flow: Show refetch or fetch button */}
              {listing.sourceType === 'api' && (
                hasApiResponse ? (
                  <SplitButton
                    primaryLabel="Re-fetch from API"
                    primaryIcon={<RefreshCw className="h-4 w-4" />}
                    primaryAction={() => setShowRefetchConfirm(true)}
                    isLoading={isFetching}
                    disabled={isAnyOperationInProgress}
                    variant="secondary"
                    size="sm"
                    dropdownItems={[
                      {
                        label: 'Add Transcripts',
                        icon: <FileText className="h-4 w-4" />,
                        action: handleAddTranscript,
                        description: 'Replace with uploaded transcript',
                        disabled: isAnyOperationInProgress,
                      },
                    ]}
                  />
                ) : (
                  <SplitButton
                    primaryLabel="Fetch from API"
                    primaryIcon={<Cloud className="h-4 w-4" />}
                    primaryAction={handleFetchFromApi}
                    isLoading={isFetching}
                    disabled={isAnyOperationInProgress}
                    size="sm"
                    variant="secondary"
                    dropdownItems={[
                      {
                        label: 'Add Transcripts',
                        icon: <FileText className="h-4 w-4" />,
                        action: handleAddTranscript,
                        description: 'Upload .txt or .json transcript file',
                        disabled: isAnyOperationInProgress,
                      },
                    ]}
                  />
                )
              )}

              {/* Upload flow: Can still add/replace transcripts */}
              {listing.sourceType === 'upload' && (
                <SplitButton
                  primaryLabel="Fetch from API"
                  primaryIcon={<Cloud className="h-4 w-4" />}
                  primaryAction={handleFetchFromApi}
                  isLoading={isFetching}
                  disabled={isAnyOperationInProgress}
                  variant="secondary"
                  size="sm"
                  dropdownItems={[
                    {
                      label: listing.transcript ? 'Replace Transcript' : 'Add Transcripts',
                      icon: <FileText className="h-4 w-4" />,
                      action: handleAddTranscript,
                      description: 'Upload .txt or .json transcript file',
                      disabled: isAnyOperationInProgress,
                    },
                  ]}
                />
              )}

              {/* New Evaluation / Re-run button */}
              {hasExistingEval || isEvaluating ? (
                <SplitButton
                  primaryLabel={isEvaluating ? 'Running...' : 'Re-run Evaluation'}
                  primaryIcon={isEvaluating ? <Clock className="h-4 w-4 animate-pulse" /> : <RefreshCw className="h-4 w-4" />}
                  primaryAction={isEvaluating ? cancelEvaluation : () => handleOpenEvalModal()}
                  isLoading={false}
                  disabled={isEvaluating ? false : isAnyOperationInProgress || !canEvaluate}
                  variant="secondary"
                  size="sm"
                  dropdownItems={isEvaluating ? [] : [
                    {
                      label: 'With Time Segments',
                      icon: <Clock className="h-4 w-4" />,
                      action: () => handleOpenEvalModal('segments'),
                      description: 'Segment-based evaluation with time alignment',
                      disabled: listing.sourceType === 'api' || isAnyOperationInProgress,
                    },
                    {
                      label: 'Regular Evaluation',
                      icon: <Play className="h-4 w-4" />,
                      action: () => handleOpenEvalModal('regular'),
                      description: 'Standard evaluation without time segments',
                      disabled: isAnyOperationInProgress,
                    },
                  ]}
                />
              ) : canEvaluate ? (
                <SplitButton
                  primaryLabel="New Evaluation"
                  primaryIcon={<Play className="h-4 w-4" />}
                  primaryAction={() => handleOpenEvalModal()}
                  isLoading={false}
                  disabled={isAnyOperationInProgress}
                  variant="secondary"
                  size="sm"
                  dropdownItems={[
                    {
                      label: 'With Time Segments',
                      icon: <Clock className="h-4 w-4" />,
                      action: () => handleOpenEvalModal('segments'),
                      description: 'Segment-based evaluation with time alignment',
                      disabled: listing.sourceType === 'api' || isAnyOperationInProgress,
                    },
                    {
                      label: 'Regular Evaluation',
                      icon: <Play className="h-4 w-4" />,
                      action: () => handleOpenEvalModal('regular'),
                      description: 'Standard evaluation without time segments',
                      disabled: isAnyOperationInProgress,
                    },
                  ]}
                />
              ) : null}

              <ExportDropdown listing={listing} size="sm" disabled={isAnyOperationInProgress} />
            </div>
          </div>
          <MetricsBar metrics={metrics} />
          {/* Evaluator Metrics */}
          <EvaluatorMetrics listing={listing} evaluators={evaluators} />
        </div>
        {/* Tabs fill remaining height */}
        <Tabs 
          tabs={tabs} 
          defaultTab={activeTab}
          onChange={handleTabChange}
          fillHeight
        />

        {/* Refetch confirmation dialog */}
        <ConfirmDialog
          isOpen={showRefetchConfirm}
          onClose={() => setShowRefetchConfirm(false)}
          onConfirm={handleRefetchFromApi}
          title="Re-fetch from API?"
          description="This will replace the current API response and clear any existing AI evaluation. Continue?"
          confirmLabel="Re-fetch"
          variant="warning"
        />

        {/* Evaluation Modal */}
        <EvaluationOverlay
          isOpen={isEvalModalOpen}
          onClose={handleCloseEvalModal}
          listing={listing}
          onStartEvaluation={handleStartEvaluation}
          hasAudioBlob={hasAudioBlob}
          initialVariant={evalVariant}
        />
      </div>
    </FeatureErrorBoundary>
  );
}
