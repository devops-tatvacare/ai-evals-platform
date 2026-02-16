import { useState, useEffect } from 'react';
import { X, Copy, CheckCircle2, XCircle, Clock } from 'lucide-react';
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
  const [isVisible, setIsVisible] = useState(false);

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
    success: <CheckCircle2 className="h-5 w-5 text-[var(--color-success)]" />,
    error: <XCircle className="h-5 w-5 text-[var(--color-error)]" />,
    timeout: <Clock className="h-5 w-5 text-[var(--color-warning)]" />,
    cancelled: <XCircle className="h-5 w-5 text-[var(--text-muted)]" />,
    pending: <Clock className="h-5 w-5 text-[var(--color-info)]" />,
  };

  const durationSec = run.durationMs ? (run.durationMs / 1000).toFixed(2) : null;

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
          "ml-auto relative z-10 h-full w-[700px] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden",
          "flex flex-col",
          "transform transition-transform duration-300 ease-out",
          isVisible ? "translate-x-0" : "translate-x-full"
        )}
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
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Evaluator Output - Dynamic Fields */}
          {run.status === 'success' && run.data.output_payload && Array.isArray(run.data.config_snapshot?.output_schema) && (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">
                Evaluator Output
              </h4>
              <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg p-4">
                {(() => {
                  // Parse output_payload if it's a string (new data format)
                  // Keep as object if already parsed (old data format)
                  try {
                    const outputData = typeof run.data.output_payload === 'string'
                      ? JSON.parse(run.data.output_payload)
                      : run.data.output_payload;

                    // Validate it's an object
                    if (!outputData || typeof outputData !== 'object') {
                      throw new Error('Invalid output data format');
                    }

                    return (
                      <DynamicFieldsDisplay
                        fields={run.data.config_snapshot.output_schema}
                        data={outputData as Record<string, unknown>}
                      />
                    );
                  } catch (error) {
                    console.error('[EvaluatorHistoryDetailsOverlay] Failed to parse output_payload', {
                      error: error instanceof Error ? error.message : 'Unknown',
                      payloadType: typeof run.data.output_payload,
                      payloadPreview: typeof run.data.output_payload === 'string' 
                        ? run.data.output_payload.substring(0, 100)
                        : 'Not a string',
                    });
                    
                    return (
                      <div className="text-sm text-[var(--color-error)]">
                        Failed to parse evaluator output. Check OUTPUT PAYLOAD section below for raw data.
                      </div>
                    );
                  }
                })()}
              </div>
            </section>
          )}

          {/* Error Details */}
          {run.status === 'error' && run.data.error_details && (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold text-[var(--color-error)] uppercase tracking-wide">
                Error Details
              </h4>
              <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded-lg p-4">
                <pre className="text-xs text-[var(--color-error)] whitespace-pre-wrap font-mono">
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
                  <CheckCircle2 className="h-3 w-3 text-[var(--color-success)]" />
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
                    <CheckCircle2 className="h-3 w-3 text-[var(--color-success)]" />
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
        </div>
      </div>
    </div>
  );
}
