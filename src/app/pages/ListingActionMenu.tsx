/**
 * State-adaptive action menu for listing page header.
 *
 * First-time / discovery actions render as inline buttons so users
 * can see what to do next.  Once an action has been completed at least
 * once (hasApiResponse, hasExistingEval, …) the repeat variant moves
 * into the overflow (⋯) menu so metrics stay prominent.
 *
 * Active-operation states (fetching, evaluating, …) show inline
 * feedback regardless of whether the trigger was inline or menu.
 */
import { useState, useRef, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { MoreHorizontal, RefreshCw, Cloud, FileText, Download, FileType, Play, Loader2 } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { exporterRegistry, downloadBlob, resolveVoiceRxExport, type Exporter } from '@/services/export';
import { cn } from '@/utils';
import type { Listing } from '@/types';

interface ActionItem {
  id: string;
  label: string;
  icon: ReactNode;
  action: () => void;
  disabled?: boolean;
  description?: string;
  /** Visual separator before this item */
  divider?: boolean;
}

interface ListingActionMenuProps {
  listing: Listing;
  appId: string;
  /** Data-source actions */
  onFetchFromApi: () => void;
  onRefetchFromApi: () => void;
  onAddTranscript: () => void;
  /** Eval actions */
  onOpenEvalModal: (variant?: 'segments' | 'regular') => void;
  /** Operation flags */
  isFetching: boolean;
  isAddingTranscript: boolean;
  isAnyOperationInProgress: boolean;
  isEvaluating: boolean;
  canEvaluate: boolean;
  hasExistingEval: boolean;
}

export function ListingActionMenu({
  listing,
  appId,
  onFetchFromApi,
  onRefetchFromApi,
  onAddTranscript,
  onOpenEvalModal,
  isFetching,
  isAddingTranscript,
  isAnyOperationInProgress,
  isEvaluating,
  canEvaluate,
  hasExistingEval,
}: ListingActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasApiResponse = !!listing.apiResponse;
  const hasTranscript = !!listing.transcript;

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen]);

  // Build export actions from registry
  const exporters = useMemo(() => exporterRegistry.getAll(), []);

  const getExportIcon = (exporter: Exporter) => {
    switch (exporter.id) {
      case 'csv':
        return <FileText className="h-3.5 w-3.5" />;
      case 'pdf':
        return <FileType className="h-3.5 w-3.5" />;
      default:
        return <Download className="h-3.5 w-3.5" />;
    }
  };

  const handleExport = useCallback(async (exporter: Exporter) => {
    setIsOpen(false);
    setIsExporting(exporter.id);
    try {
      const payload = await resolveVoiceRxExport(appId, listing);
      const blob = await exporter.export(payload);
      const safeTitle = listing.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      downloadBlob(blob, `${safeTitle}_${exporter.id}.${exporter.extension}`);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(null);
    }
  }, [appId, listing]);

  /* ── Partition actions into inline vs overflow ────────── */

  const inlineActions: ActionItem[] = [];
  const menuActions: ActionItem[] = [];

  // ── Data-source actions ──────────────────────────────
  if (listing.sourceType === 'pending') {
    // Fresh listing — both data-source paths are first-time discovery
    inlineActions.push({
      id: 'fetch-api',
      label: isFetching ? 'Fetching...' : 'Fetch from API',
      icon: isFetching
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : <Cloud className="h-3.5 w-3.5" />,
      action: onFetchFromApi,
      disabled: isAnyOperationInProgress,
    });
    inlineActions.push({
      id: 'add-transcript',
      label: isAddingTranscript ? 'Adding...' : 'Add Transcripts',
      icon: isAddingTranscript
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : <FileText className="h-3.5 w-3.5" />,
      action: onAddTranscript,
      disabled: isAnyOperationInProgress,
    });
  } else if (listing.sourceType === 'api') {
    if (!hasApiResponse) {
      // API flow chosen but first fetch not done yet — inline
      inlineActions.push({
        id: 'fetch-api',
        label: isFetching ? 'Fetching...' : 'Fetch from API',
        icon: isFetching
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <Cloud className="h-3.5 w-3.5" />,
        action: onFetchFromApi,
        disabled: isAnyOperationInProgress,
      });
    } else {
      // Already fetched — repeat action goes to menu
      menuActions.push({
        id: 'refetch-api',
        label: 'Re-fetch from API',
        icon: <RefreshCw className="h-3.5 w-3.5" />,
        action: () => { setIsOpen(false); onRefetchFromApi(); },
        disabled: isAnyOperationInProgress || isFetching,
      });
    }
  } else if (listing.sourceType === 'upload') {
    // Upload flow — transcript update is a repeat action
    menuActions.push({
      id: 'update-transcript',
      label: hasTranscript ? 'Update Transcript' : 'Add Transcript',
      icon: <FileText className="h-3.5 w-3.5" />,
      action: () => { setIsOpen(false); onAddTranscript(); },
      disabled: isAnyOperationInProgress || isAddingTranscript,
    });
  }

  // ── Evaluation action ────────────────────────────────
  if (isEvaluating) {
    // Active evaluation — always show inline feedback
    inlineActions.push({
      id: 'eval-running',
      label: 'Evaluating...',
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      action: () => {},
      disabled: true,
    });
  } else if (canEvaluate) {
    if (!hasExistingEval) {
      // First evaluation — inline for discovery
      inlineActions.push({
        id: 'run-eval',
        label: 'Run Evaluation',
        icon: <Play className="h-3.5 w-3.5" />,
        action: () => onOpenEvalModal(),
        disabled: isAnyOperationInProgress,
      });
    } else {
      // Already evaluated — repeat goes to menu
      menuActions.push({
        id: 'rerun-eval',
        label: 'Re-run Evaluation',
        icon: <RefreshCw className="h-3.5 w-3.5" />,
        action: () => { setIsOpen(false); onOpenEvalModal(); },
        disabled: isAnyOperationInProgress,
        divider: true,
      });
    }
  }

  // ── Export actions — always overflow ──────────────────
  if (exporters.length > 0) {
    exporters.forEach((exporter, i) => {
      menuActions.push({
        id: `export-${exporter.id}`,
        label: `Export ${exporter.name}`,
        icon: getExportIcon(exporter),
        action: () => handleExport(exporter),
        disabled: isAnyOperationInProgress || isExporting !== null,
        divider: i === 0,
      });
    });
  }

  const hasMenuActions = menuActions.length > 0;

  return (
    <div className="flex items-center gap-1.5">
      {/* Inline action buttons — visible for first-time / active states */}
      {inlineActions.map((item) => (
        <Tooltip key={item.id} content={item.description ?? item.label} position="bottom">
          <button
            type="button"
            onClick={item.action}
            disabled={item.disabled}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors',
              item.disabled
                ? 'border-[var(--border-subtle)] text-[var(--text-muted)] cursor-not-allowed opacity-60'
                : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)]',
            )}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        </Tooltip>
      ))}

      {/* Overflow menu — repeat actions, exports, secondary actions */}
      {hasMenuActions && (
        <div ref={menuRef} className="relative">
          <Tooltip content="More actions" position="bottom">
            <button
              type="button"
              onClick={() => setIsOpen(prev => !prev)}
              className={cn(
                'h-7 w-7 flex items-center justify-center rounded-md border transition-colors',
                isOpen
                  ? 'bg-[var(--bg-tertiary)] border-[var(--border-default)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)]',
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </Tooltip>

          {isOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-lg py-1">
              {menuActions.map((item) => (
                <div key={item.id}>
                  {item.divider && (
                    <div className="border-t border-[var(--border-subtle)] my-1" />
                  )}
                  <button
                    type="button"
                    onClick={item.action}
                    disabled={item.disabled}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors',
                      item.disabled
                        ? 'text-[var(--text-muted)] cursor-not-allowed opacity-50'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]',
                    )}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
