import { useState, useEffect, useCallback } from 'react';
import { X, GitFork, Search } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { useEvaluatorsStore } from '@/stores';
import { cn } from '@/utils';
import type { Listing } from '@/types';

interface EvaluatorRegistryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  listing: Listing;
  onFork: (sourceId: string) => Promise<void>;
}

export function EvaluatorRegistryPicker({ 
  isOpen, 
  onClose, 
  listing,
  onFork 
}: EvaluatorRegistryPickerProps) {
  const [search, setSearch] = useState('');
  const [forking, setForking] = useState<string | null>(null);
  
  const { registry, isRegistryLoaded, loadRegistry, evaluators } = useEvaluatorsStore();
  
  // Handle escape key
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, handleEscape]);
  
  useEffect(() => {
    if (isOpen && !isRegistryLoaded) {
      loadRegistry(listing.appId);
    }
  }, [isOpen, isRegistryLoaded, listing.appId, loadRegistry]);
  
  // Filter out evaluators already in this listing (by forkedFrom or same id)
  const existingForkedFromIds = new Set(
    evaluators
      .filter(e => e.listingId === listing.id)
      .map(e => e.forkedFrom)
      .filter(Boolean)
  );
  
  const availableRegistry = registry.filter(e => 
    // Not already forked to this listing
    !existingForkedFromIds.has(e.id) &&
    // Not owned by this listing (can't fork your own)
    e.listingId !== listing.id &&
    // Search filter
    (search === '' || e.name.toLowerCase().includes(search.toLowerCase()))
  );
  
  const handleFork = async (sourceId: string) => {
    setForking(sourceId);
    try {
      await onFork(sourceId);
      onClose();
    } finally {
      setForking(null);
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div 
        className={cn(
          "absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0"
        )}
      />
      
      {/* Slide-in panel */}
      <div 
        className={cn(
          "ml-auto relative z-10 h-full w-[600px] bg-[var(--bg-elevated)] shadow-2xl",
          "flex flex-col",
          "transform transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Add from Registry
          </h2>
          <button
            onClick={onClose}
            className="rounded-[6px] p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        {/* Search */}
        <div className="px-6 py-3 border-b border-[var(--border-subtle)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search evaluators..."
              className="pl-10"
            />
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-2">
            Fork an evaluator to create an independent copy in this listing.
          </p>
        </div>
        
        {/* List */}
        <div className="flex-1 overflow-y-auto p-6">
          {!isRegistryLoaded ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-brand-accent)] border-t-transparent" />
            </div>
          ) : availableRegistry.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[var(--text-muted)]">
                {search 
                  ? 'No matching evaluators found' 
                  : registry.length === 0 
                    ? 'No evaluators in registry yet. Add evaluators to the registry from any listing.'
                    : 'All registry evaluators are already in this listing.'
                }
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {availableRegistry.map(evaluator => (
                <div
                  key={evaluator.id}
                  className={cn(
                    "border border-[var(--border-default)] rounded-lg p-4",
                    "hover:border-[var(--color-brand-accent)] transition-colors",
                    "bg-[var(--bg-surface)]"
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-[var(--text-primary)] truncate">
                        {evaluator.name}
                      </h3>
                      <p className="text-sm text-[var(--text-muted)] mt-1 line-clamp-2">
                        {evaluator.prompt.slice(0, 150)}...
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-muted)]">
                        <span>{evaluator.outputSchema.length} output field(s)</span>
                        <span>•</span>
                        <span>{evaluator.modelId}</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleFork(evaluator.id)}
                      disabled={forking !== null}
                    >
                      <GitFork className="h-4 w-4 mr-1.5" />
                      {forking === evaluator.id ? 'Forking...' : 'Fork'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
