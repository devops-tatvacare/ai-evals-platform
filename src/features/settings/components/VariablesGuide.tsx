import { useState, memo } from 'react';
import { ChevronDown, ChevronRight, HelpCircle, Sparkles } from 'lucide-react';
import { cn } from '@/utils';
import { getAvailableVariables } from '@/services/templates';
import type { PromptType, TemplateVariableStatus } from '@/types';

interface VariablesGuideProps {
  promptType: PromptType;
  variableStatuses?: Map<string, TemplateVariableStatus>;
  className?: string;
}

/**
 * Collapsible reference panel showing all available variables with their
 * descriptions, status, and resolved values.
 */
export const VariablesGuide = memo(function VariablesGuide({
  promptType,
  variableStatuses,
  className,
}: VariablesGuideProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const availableVariables = getAvailableVariables(promptType);

  // Count required variables
  const requiredCount = availableVariables.filter(
    (v) => v.required || v.requiredFor?.includes(promptType)
  ).length;

  // Get preview value for a variable (truncated)
  const getPreviewValue = (key: string): string | null => {
    const status = variableStatuses?.get(key);
    if (!status) return null;
    
    // Extract a meaningful preview from the reason
    if (status.reason) {
      // Extract numbers or short values
      const match = status.reason.match(/(\d+)/);
      if (match) return match[1];
      if (status.reason.includes('From settings')) return '✓';
      if (status.reason.includes('Will be')) return '⏳';
      if (status.reason.includes('loaded')) return '✓';
    }
    return status.available ? '✓' : '—';
  };

  return (
    <div className={cn('rounded-lg border border-[var(--border-subtle)] overflow-hidden', className)}>
      {/* Collapsed Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
          )}
          <HelpCircle className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">
            Variables Guide
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <span>{availableVariables.length} available</span>
          {requiredCount > 0 && (
            <>
              <span>•</span>
              <span className="text-[var(--color-warning)]">{requiredCount} required</span>
            </>
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]">
          {/* Quick Tip */}
          <div className="px-3 py-2 bg-[var(--color-brand-accent)]/10 border-b border-[var(--border-subtle)] flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 text-[var(--color-brand-primary)] mt-0.5 shrink-0" />
            <p className="text-[11px] text-[var(--text-secondary)]">
              Click any variable chip below to insert it at your cursor position. 
              Variables are replaced with actual values when the evaluation runs.
            </p>
          </div>

          {/* Variables Table */}
          <div className="max-h-[240px] overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-[var(--bg-secondary)]">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-muted)]">Variable</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-muted)]">Description</th>
                  <th className="px-3 py-2 text-center font-medium text-[var(--text-muted)] w-16">Status</th>
                  <th className="px-3 py-2 text-right font-medium text-[var(--text-muted)] w-20">Value</th>
                </tr>
              </thead>
              <tbody>
                {availableVariables.map((variable) => {
                  const status = variableStatuses?.get(variable.key);
                  const isRequired = variable.required || variable.requiredFor?.includes(promptType);
                  const isAvailable = status?.available !== false;
                  const isPending = status?.reason?.includes('Will be') || status?.reason?.includes('not yet');
                  const previewValue = getPreviewValue(variable.key);

                  return (
                    <tr
                      key={variable.key}
                      className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-secondary)]/50"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-[var(--text-primary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded">
                            {variable.key}
                          </code>
                          {isRequired && (
                            <span className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded bg-[var(--color-warning-light)] text-[var(--color-warning)]">
                              Required
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                          {variable.label}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">
                        {variable.description}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isPending ? (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-warning-light)] text-[var(--color-warning)]">
                            ⏳
                          </span>
                        ) : isAvailable ? (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-success-light)] text-[var(--color-success)]">
                            ✓
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-error-light)] text-[var(--color-error)]">
                            ✗
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={cn(
                          'font-mono',
                          isAvailable ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'
                        )}>
                          {previewValue || '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="px-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex items-center gap-4 text-[10px] text-[var(--text-muted)]">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-[var(--color-success-light)] inline-flex items-center justify-center text-[var(--color-success)]">✓</span>
              Ready
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-[var(--color-warning-light)] inline-flex items-center justify-center text-[var(--color-warning)]">⏳</span>
              Pending
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-[var(--color-error-light)] inline-flex items-center justify-center text-[var(--color-error)]">✗</span>
              Missing
            </span>
          </div>
        </div>
      )}
    </div>
  );
});
