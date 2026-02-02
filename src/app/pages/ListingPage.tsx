import { useParams, useSearchParams } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { Tabs, Card, Skeleton } from '@/components/ui';
import { FeatureErrorBoundary } from '@/components/feedback';
import { TranscriptView } from '@/features/transcript';
import { StructuredOutputsView } from '@/features/structured-outputs';
import { EvalsView, MetricsBar } from '@/features/evals';
import { useListingMetrics } from '@/features/evals/hooks';
import { ExportDropdown } from '@/features/export';
import { listingsRepository } from '@/services/storage';
import { useListingsStore, useAppStore } from '@/stores';
import type { Listing } from '@/types';

export function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [listing, setListing] = useState<Listing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const appId = useAppStore((state) => state.currentApp);
  const setSelectedId = useListingsStore((state) => state.setSelectedId);
  const listings = useListingsStore((state) => state.listings[appId] || []);

  // Load listing from IndexedDB or fallback to store
  useEffect(() => {
    async function loadListing() {
      if (!id) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        // First try to get from DB
        let data = await listingsRepository.getById(appId, id);
        
        // If not in DB, check the in-memory store (for newly created listings)
        if (!data) {
          data = listings.find(l => l.id === id);
        }
        
        if (data) {
          setListing(data);
          setSelectedId(id);
        } else {
          setError('Listing not found');
        }
      } catch (err) {
        console.error('Failed to load listing:', err);
        setError('Failed to load listing');
      } finally {
        setIsLoading(false);
      }
    }

    loadListing();
  }, [id, appId, setSelectedId, listings]);

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
      <Card className="p-8 text-center">
        <p className="text-[var(--color-error)]">{error || 'Listing not found'}</p>
      </Card>
    );
  }

  const tabs = [
    {
      id: 'transcript',
      label: 'Transcript',
      content: <TranscriptView listing={listing} />,
    },
    {
      id: 'structured-outputs',
      label: 'Structured Outputs',
      content: <StructuredOutputsView listing={listing} onUpdate={handleListingUpdate} />,
    },
    {
      id: 'evals',
      label: 'Evals',
      content: <EvalsView listing={listing} onUpdate={handleListingUpdate} />,
    },
  ];

  return (
    <FeatureErrorBoundary featureName="Listing">
      <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
        {/* Sticky header */}
        <div className="shrink-0 pb-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">
              {listing.title}
            </h1>
            <ExportDropdown listing={listing} />
          </div>
          <MetricsBar metrics={metrics} />
        </div>
        {/* Tabs fill remaining height */}
        <Tabs 
          tabs={tabs} 
          defaultTab={activeTab}
          onChange={handleTabChange}
          fillHeight
        />
      </div>
    </FeatureErrorBoundary>
  );
}
