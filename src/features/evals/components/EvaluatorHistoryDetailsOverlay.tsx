import { useState, useEffect, useCallback } from 'react';
import { X, Copy, ChevronDown, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui';
import { DynamicFieldsDisplay } from './DynamicFieldsDisplay';
import { formatDate } from '@/utils';
import { cn } from '@/utils';
import type { EvaluatorRunHistory } from '@/types';

interface EvaluatorHistoryDetailsOverlayProps {
  isOpen: boolean;
  run: EvaluatorRunHistory;
  onClose: () => void;
}

export function EvaluatorHistoryDetailsOverlay({
  isOpen,
  run,
  onClose,
}: EvaluatorHistoryDetailsOverlayProps) {
  const [copied, setCopied] = useState<'input' | 'output' | null>(null);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, handleEscape]);

  const handleCopy = async (data: unknown, type: 'input' | 'output') => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const statusIcon = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
    error: <XCircle className="h-5 w-5 text-red-500" />,
    timeout: <Clock className="h-5 w-5 text-amber-500" />,
    cancelled: <XCircle className="h-5 w-5 text-gray-500" />,
    pending: <Clock className="h-5 w-5 text-blue-500" />,
  };

  const durationSec = run.duration_ms ? (run.duration_ms / 1000).toFixed(2) : null;

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" />

      {/* Secondary slide-in panel (narrower, on top) */}
      <div 
        className={cn(
          "ml-auto relative z-20 h-full w-[700px] bg-[var(--bg-elevated)] shadow-2xl",
          "flex flex-col",
          "transform transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            {statusIcon[run.status]}
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                Run Details
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {formatDate(new Date(run.timestamp))}
                {durationSec && ` • ${durationSec}s`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-[6px] p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Evaluator Output - Dynamic Fields */}
          {run.status === 'success' && run.data.output_payload && Array.isArray(run.data.config_snapshot?.output_schema) && (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">
                Evaluator Output
              </h4>
              <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg p-4">
                <DynamicFieldsDisplay
                  fields={run.data.config_snapshot.output_schema}
                  data={run.data.output_payload as Record<string, unknown>}
                />
              </div>
            </section>
          )}

          {/* Error Details */}
          {run.status === 'error' && run.data.error_details && (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">
                Error Details
              </h4>
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <pre className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap font-mono">
                  {JSON.stringify(run.data.error_details, null, 2)}
                </pre>
              </div>
            </section>
          )}

          {/* Input Payload - Always Visible */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">
                Input Payload
              </h4>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCopy(run.data.input_payload, 'input')}
                className="h-6 px-2 text-xs"
              >
                {copied === 'input' ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                ) : (
                  <>
                    <Copy className="h-3 w-3 mr-1" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg p-4 overflow-x-auto max-h-64 overflow-y-auto">
              <pre className="text-xs text-[var(--text-primary)] font-mono whitespace-pre-wrap">
                {typeof run.data.input_payload === 'string' 
                  ? run.data.input_payload 
                  : JSON.stringify(run.data.input_payload, null, 2)}
              </pre>
            </div>
          </section>

          {/* Output Payload - Always Visible */}
          {run.data.output_payload && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">
                  Output Payload
                </h4>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleCopy(run.data.output_payload, 'output')}
                  className="h-6 px-2 text-xs"
                >
                  {copied === 'output' ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <>
                      <Copy className="h-3 w-3 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg p-4 overflow-x-auto max-h-64 overflow-y-auto">
                <pre className="text-xs text-[var(--text-primary)] font-mono whitespace-pre-wrap">
                  {typeof run.data.output_payload === 'string'
                    ? run.data.output_payload
                    : JSON.stringify(run.data.output_payload, null, 2)}
                </pre>
              </div>
            </section>
          )}

          {/* Config Snapshot */}
          <section className="space-y-2">
            <details className="group">
              <summary className="cursor-pointer text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide hover:text-[var(--text-primary)] transition-colors flex items-center gap-2">
                <ChevronDown className="h-3 w-3 group-open:rotate-180 transition-transform" />
                Configuration
              </summary>
              <div className="mt-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg p-4 overflow-x-auto">
                <pre className="text-xs text-[var(--text-muted)] font-mono">
                  {JSON.stringify(run.data.config_snapshot, null, 2)}
                </pre>
              </div>
            </details>
          </section>

          {/* Metadata */}
          <section className="pt-2 border-t border-[var(--border-subtle)]">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-[var(--text-muted)]">Evaluator:</span>
                <div className="text-[var(--text-primary)] font-medium mt-0.5">
                  {run.data.evaluator_name}
                </div>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Type:</span>
                <div className="text-[var(--text-primary)] font-medium mt-0.5">
                  {run.data.evaluator_type}
                </div>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Triggered By:</span>
                <div className="text-[var(--text-primary)] font-medium mt-0.5">
                  {run.triggered_by}
                </div>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Schema Version:</span>
                <div className="text-[var(--text-primary)] font-medium mt-0.5 font-mono">
                  {run.schema_version}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
