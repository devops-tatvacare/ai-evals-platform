import { useState } from 'react';
import { Play, MoreVertical, Edit, Trash2, Clock, CheckCircle2, XCircle, History, X, Globe, GitFork } from 'lucide-react';
import { Button, Tooltip } from '@/components/ui';
import { cn } from '@/utils';
import { EvaluatorHistoryListOverlay } from './EvaluatorHistoryListOverlay';
import { EvaluatorHistoryDetailsOverlay } from './EvaluatorHistoryDetailsOverlay';
import type { EvaluatorDefinition, EvaluatorRun, Listing, EvaluatorOutputField, EvaluatorRunHistory } from '@/types';

interface EvaluatorCardProps {
  evaluator: EvaluatorDefinition;
  listing?: Listing;
  entityId?: string;
  latestRun?: EvaluatorRun;
  onRun: (evaluator: EvaluatorDefinition) => void;
  onCancel?: (evaluatorId: string) => void;
  onEdit: (evaluator: EvaluatorDefinition) => void;
  onDelete: (evaluatorId: string) => void;
  onToggleHeader: (evaluatorId: string, showInHeader: boolean) => void;
  onToggleGlobal: (evaluatorId: string, isGlobal: boolean) => void;
}

type OverlayState = 'none' | 'list' | 'details';

// Helper to get color based on thresholds
function getThresholdColor(value: number, field: EvaluatorOutputField) {
  if (!field.thresholds || field.type !== 'number') return null;

  if (value >= field.thresholds.green) {
    return {
      bg: 'bg-[var(--color-success)]/10',
      text: 'text-[var(--color-success)]',
      border: 'border-[var(--color-success)]/30'
    };
  } else if (value >= field.thresholds.yellow) {
    return {
      bg: 'bg-[var(--color-warning)]/10',
      text: 'text-[var(--color-warning)]',
      border: 'border-[var(--color-warning)]/30'
    };
  } else {
    return {
      bg: 'bg-[var(--color-error)]/10',
      text: 'text-[var(--color-error)]',
      border: 'border-[var(--color-error)]/30'
    };
  }
}

export function EvaluatorCard({
  evaluator,
  listing,
  entityId,
  latestRun,
  onRun,
  onCancel,
  onEdit,
  onDelete,
  onToggleHeader,
  onToggleGlobal
}: EvaluatorCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [overlayState, setOverlayState] = useState<OverlayState>('none');
  const [selectedRun, setSelectedRun] = useState<EvaluatorRunHistory | null>(null);
  
  const isRunning = latestRun?.status === 'processing';
  const mainMetricField = evaluator.outputSchema.find(f => f.isMainMetric);
  const mainMetricValue = latestRun?.output?.[mainMetricField?.key || ''];
  const cardBodyFields = evaluator.outputSchema.filter(f => f.displayMode === 'card');

  const handleSelectRun = (run: EvaluatorRunHistory) => {
    setSelectedRun(run);
    setOverlayState('details');
  };

  const handleCloseDetails = () => {
    setSelectedRun(null);
    setOverlayState('list');
  };

  const handleCloseList = () => {
    setOverlayState('none');
    setSelectedRun(null);
  };
  
  return (
    <div className={cn(
      "rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden",
      "hover:border-[var(--border-default)] transition-colors"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h4 className="font-medium text-[13px] truncate text-[var(--text-primary)]">
            {evaluator.name}
          </h4>
          {latestRun && (
            <div className="flex-shrink-0">
              {isRunning && <Clock className="h-3 w-3 text-[var(--color-info)] animate-pulse" />}
              {latestRun.status === 'completed' && <CheckCircle2 className="h-3 w-3 text-[var(--color-success)]" />}
              {latestRun.status === 'failed' && <XCircle className="h-3 w-3 text-[var(--color-error)]" />}
            </div>
          )}
          {/* Badges - inline with title */}
          {(evaluator.isGlobal || evaluator.forkedFrom) && (
            <div className="flex items-center gap-1 flex-shrink-0">
              {evaluator.isGlobal && (
                <Tooltip content="Available in Registry for other listings to fork">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--color-brand-accent)]/10 text-[var(--color-brand-accent)]">
                    <Globe className="h-3 w-3" />
                  </span>
                </Tooltip>
              )}
              {evaluator.forkedFrom && (
                <Tooltip content="Forked from Registry">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                    <GitFork className="h-3 w-3" />
                  </span>
                </Tooltip>
              )}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-1">
          {isRunning ? (
            <>
              {/* Running spinner */}
              <div className="h-6 w-6 flex items-center justify-center">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-info)] border-t-transparent" />
              </div>
              {/* Cancel button */}
              {onCancel && (
                <Tooltip content="Cancel">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onCancel(evaluator.id)}
                    className="h-6 w-6 p-0 text-[var(--color-error)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Tooltip>
              )}
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRun(evaluator)}
              className="h-6 w-6 p-0"
            >
              <Play className="h-3 w-3" />
            </Button>
          )}
          
          <div className="relative">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowMenu(!showMenu)}
              className="h-6 w-6 p-0"
            >
              <MoreVertical className="h-3 w-3" />
            </Button>
            
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className={cn(
                  "absolute right-0 mt-1 z-20 bg-[var(--bg-primary)] border border-[var(--border-default)]",
                  "rounded-md shadow-lg py-1 min-w-[160px]"
                )}>
                  <button
                    onClick={() => {
                      setOverlayState('list');
                      setShowMenu(false);
                    }}
                    className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--interactive-secondary)] flex items-center gap-2 text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                  >
                    <History className="h-3.5 w-3.5" />
                    History
                  </button>
                  <button
                    onClick={() => {
                      onToggleGlobal(evaluator.id, !evaluator.isGlobal);
                      setShowMenu(false);
                    }}
                    className={cn(
                      "w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--interactive-secondary)]",
                      "flex items-center gap-2 text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                    )}
                  >
                    <Globe className={cn("h-3.5 w-3.5", evaluator.isGlobal ? 'text-[var(--color-brand-accent)]' : 'text-[var(--text-muted)]')} />
                    {evaluator.isGlobal ? 'Remove from Registry' : 'Add to Registry'}
                  </button>
                  <button
                    onClick={() => {
                      onToggleHeader(evaluator.id, !evaluator.showInHeader);
                      setShowMenu(false);
                    }}
                    className={cn(
                      "w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--interactive-secondary)]",
                      "flex items-center gap-2 text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                    )}
                  >
                    <CheckCircle2 className={cn("h-3.5 w-3.5", evaluator.showInHeader ? 'text-[var(--color-success)]' : 'text-[var(--text-muted)]')} />
                    Show in Header
                  </button>
                  <button
                    onClick={() => {
                      onEdit(evaluator);
                      setShowMenu(false);
                    }}
                    className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--interactive-secondary)] flex items-center gap-2 text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                  >
                    <Edit className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      onDelete(evaluator.id);
                      setShowMenu(false);
                    }}
                    className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--interactive-secondary)] flex items-center gap-2 text-[var(--color-error)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      
      {/* Main Metric - ALWAYS show if field exists */}
      {mainMetricField && (
        <div className={cn(
          "px-3 py-3 border-b border-[var(--border-subtle)]",
          typeof mainMetricValue === 'number' && latestRun?.status === 'completed' && getThresholdColor(mainMetricValue, mainMetricField)?.bg
        )}>
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              {mainMetricField.key.replace(/_/g, ' ')}
            </span>
            {latestRun?.status === 'completed' && mainMetricValue !== undefined ? (
              <span className={cn(
                "text-2xl font-bold",
                typeof mainMetricValue === 'number' && getThresholdColor(mainMetricValue, mainMetricField)?.text || "text-[var(--text-primary)]"
              )}>
                {formatMetricValue(mainMetricValue, mainMetricField.type)}
              </span>
            ) : isRunning ? (
              <div className="h-7 w-16 animate-pulse bg-[var(--bg-tertiary)] rounded" />
            ) : (
              <span className="text-xl text-[var(--text-muted)]">—</span>
            )}
          </div>
        </div>
      )}
      
      {/* Card Body Fields - ALWAYS show if fields exist */}
      {cardBodyFields.length > 0 && (
        <div className="p-3 space-y-2">
          {cardBodyFields.map(field => {
            const value = latestRun?.output?.[field.key];
            const hasValue = value !== undefined && latestRun?.status === 'completed';
            
            const formattedValue = hasValue ? formatMetricValue(value, field.type) : '';
            const isTruncated = formattedValue.length > 120;
            const numericValue = typeof value === 'number' ? value : null;
            const colors = numericValue !== null && hasValue ? getThresholdColor(numericValue, field) : null;
            
            return (
              <div 
                key={field.key} 
                className={cn(
                  "border rounded-md p-2 min-h-[60px]",
                  colors?.border || "border-[var(--border-subtle)]",
                  colors?.bg
                )}
              >
                <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1">
                  {field.key.replace(/_/g, ' ')}
                </div>
                <div className="min-h-[32px] flex items-start">
                  {isRunning ? (
                    <div className="space-y-1.5 w-full">
                      <div className="h-3 w-full animate-pulse bg-[var(--bg-tertiary)] rounded" />
                      <div className="h-3 w-3/4 animate-pulse bg-[var(--bg-tertiary)] rounded" />
                    </div>
                  ) : hasValue ? (
                    isTruncated ? (
                      <Tooltip content={formattedValue}>
                        <div 
                          className={cn(
                            "text-[13px] leading-relaxed line-clamp-2",
                            colors?.text || "text-[var(--text-primary)]"
                          )}
                        >
                          {formattedValue}
                        </div>
                      </Tooltip>
                    ) : (
                      <div className={cn(
                        "text-[13px] leading-relaxed line-clamp-2",
                        colors?.text || "text-[var(--text-primary)]"
                      )}>
                        {formattedValue}
                      </div>
                    )
                  ) : (
                    <div className="text-[13px] text-[var(--text-muted)]">—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      {/* Error Footer - only if failed */}
      {latestRun?.status === 'failed' && (
        <div className="px-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--color-error)]/5">
          <div className="text-xs text-[var(--color-error)] flex items-center gap-2">
            <XCircle className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{latestRun.error}</span>
          </div>
        </div>
      )}

      {/* History Overlays */}
      {overlayState !== 'none' && (
        <>
          <EvaluatorHistoryListOverlay
            isOpen={overlayState === 'list' || overlayState === 'details'}
            evaluatorId={evaluator.id}
            evaluatorName={evaluator.name}
            listingId={entityId || listing?.id || ''}
            onClose={overlayState === 'details' ? () => {} : handleCloseList}
            onSelectRun={handleSelectRun}
          />
          
          {overlayState === 'details' && selectedRun && (
            <EvaluatorHistoryDetailsOverlay
              isOpen={true}
              run={selectedRun}
              onClose={handleCloseDetails}
            />
          )}
        </>
      )}
    </div>
  );
}

function formatMetricValue(value: unknown, type: string): string {
  if (value === null || value === undefined) return '-';
  
  switch (type) {
    case 'number':
      return typeof value === 'number' ? value.toFixed(2) : String(value);
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'array':
      return Array.isArray(value) ? value.join(', ') : String(value);
    default:
      return String(value);
  }
}
