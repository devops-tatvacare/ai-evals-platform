import { useState, useEffect } from 'react';
import { X, GitFork, Search, Trash2, Library } from 'lucide-react';
import { Button, Input, EmptyState } from '@/components/ui';
import { useEvaluatorsStore } from '@/stores';
import { cn } from '@/utils';
import type { Listing } from '@/types';

interface EvaluatorRegistryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  listing?: Listing;
  appId?: string;
  entityId?: string;
  onFork: (sourceId: string) => Promise<void>;
}

export function EvaluatorRegistryPicker({
  isOpen,
  onClose,
  listing,
  appId,
  entityId,
  onFork
}: EvaluatorRegistryPickerProps) {
  const [search, setSearch] = useState('');
  const [forking, setForking] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const { registry, isRegistryLoaded, loadRegistry, deleteEvaluator } = useEvaluatorsStore();

  // Trigger slide-in animation after mount
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') onClose();
      }
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen, onClose]);

  const effectiveAppId = appId || listing?.appId || 'voice-rx';
  const effectiveEntityId = entityId || listing?.id;

  useEffect(() => {
    if (isOpen && !isRegistryLoaded) {
      loadRegistry(effectiveAppId);
    }
  }, [isOpen, isRegistryLoaded, effectiveAppId, loadRegistry]);

  // Registry is a permanent catalog - show all global evaluators except those owned by this entity
  const availableRegistry = registry.filter(e =>
    // Not owned by this entity (can't fork your own)
    (!effectiveEntityId || e.listingId !== effectiveEntityId) &&
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

  const handleDelete = async (evaluatorId: string) => {
    if (!confirm('Delete this evaluator from the registry? Forked copies in listings will not be affected.')) {
      return;
    }

    setDeleting(evaluatorId);
    try {
      await deleteEvaluator(evaluatorId);
    } finally {
      setDeleting(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm transition-opacity duration-300",
          isVisible ? "opacity-100" : "opacity-0"
        )}
      />

      {/* Slide-in panel */}
      <div
        className={cn(
          "ml-auto relative z-10 h-full w-[600px] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden",
          "flex flex-col",
          "transform transition-transform duration-300 ease-out",
          isVisible ? "translate-x-0" : "translate-x-full"
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
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!isRegistryLoaded ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-brand-accent)] border-t-transparent" />
            </div>
          ) : availableRegistry.length === 0 ? (
            <EmptyState
              icon={search ? Search : Library}
              title={search ? 'No matching evaluators' : 'Registry is empty'}
              description={
                search
                  ? 'Try a different search term.'
                  : 'Mark an evaluator as global to add it to the registry, then fork it into other listings.'
              }
              className="w-full"
            />
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
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(evaluator.id)}
                        disabled={deleting !== null || forking !== null}
                        className="text-[var(--text-danger)] hover:text-[var(--text-danger)] hover:bg-[var(--bg-danger-subtle)]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleFork(evaluator.id)}
                        disabled={forking !== null || deleting !== null}
                      >
                        <GitFork className="h-4 w-4 mr-1.5" />
                        {forking === evaluator.id ? 'Forking...' : 'Fork'}
                      </Button>
                    </div>
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
