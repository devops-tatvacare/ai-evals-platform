import { memo } from 'react';
import { 
  Scale, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Quote,
  Lightbulb,
  Info
} from 'lucide-react';
import { Badge } from '@/components/ui';
import type { FieldCritique, CritiqueSeverity, ConfidenceLevel } from '@/types';

interface JudgeVerdictPaneProps {
  critique: FieldCritique | null;
}

/**
 * Get badge variant based on severity
 */
function getSeverityBadge(severity: CritiqueSeverity, match: boolean) {
  if (match) {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle className="h-3 w-3" />
        PASS
      </Badge>
    );
  }
  
  const variants: Record<CritiqueSeverity, { variant: 'error' | 'warning' | 'neutral'; label: string }> = {
    critical: { variant: 'error', label: 'CRITICAL' },
    moderate: { variant: 'warning', label: 'MODERATE' },
    minor: { variant: 'neutral', label: 'MINOR' },
    none: { variant: 'neutral', label: 'NONE' },
  };
  
  const { variant, label } = variants[severity] || variants.none;
  
  return (
    <Badge variant={variant} className="gap-1">
      {severity === 'critical' ? <XCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {label}
    </Badge>
  );
}

/**
 * Get confidence indicator
 */
function getConfidenceIndicator(confidence?: ConfidenceLevel) {
  if (!confidence) return null;
  
  const configs: Record<ConfidenceLevel, { color: string; label: string }> = {
    high: { color: 'text-[var(--color-success)]', label: 'High confidence' },
    medium: { color: 'text-[var(--color-warning)]', label: 'Medium confidence' },
    low: { color: 'text-[var(--color-error)]', label: 'Low confidence' },
  };
  
  const config = configs[confidence];
  
  return (
    <span className={`text-[10px] ${config.color}`}>
      {config.label}
    </span>
  );
}

/**
 * Format a value for display in the verdict pane
 */
function formatDisplayValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Right pane showing the judge's verdict for the selected field
 */
export const JudgeVerdictPane = memo(function JudgeVerdictPane({
  critique,
}: JudgeVerdictPaneProps) {
  if (!critique) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] p-4">
        <Scale className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm text-center">Select a field to see verdict</p>
        <p className="text-xs text-center mt-1">
          Click on any field in the center pane
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header — min-h aligned with other panes */}
      <div className="px-3 min-h-[37px] flex items-center border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide flex items-center gap-1.5">
          <Scale className="h-3.5 w-3.5" />
          Judge Verdict
        </h3>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Field name */}
        <div>
          <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
            Field
          </label>
          <p className="text-sm font-mono text-[var(--text-brand)] mt-1 break-all">
            {critique.fieldPath}
          </p>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-2">
          {getSeverityBadge(critique.severity, critique.match)}
          {getConfidenceIndicator(critique.confidence)}
        </div>

        {/* Values comparison */}
        <div className="grid grid-cols-1 gap-3">
          {/* API Value */}
          <div className="p-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
            <label className="text-[9px] font-medium text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-1">
              <Info className="h-2.5 w-2.5" />
              API Extracted Value
            </label>
            <pre className="text-xs font-mono text-[var(--text-primary)] mt-1 whitespace-pre-wrap break-words">
              {formatDisplayValue(critique.apiValue)}
            </pre>
          </div>
          
          {/* Judge Value */}
          {!critique.match && critique.judgeValue !== undefined && (
            <div className="p-2 rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5">
              <label className="text-[9px] font-medium text-[var(--color-warning)] uppercase tracking-wide flex items-center gap-1">
                <Scale className="h-2.5 w-2.5" />
                Judge Expected Value
              </label>
              <pre className="text-xs font-mono text-[var(--text-primary)] mt-1 whitespace-pre-wrap break-words">
                {formatDisplayValue(critique.judgeValue)}
              </pre>
            </div>
          )}
        </div>

        {/* Critique/Reasoning */}
        <div>
          <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-1 mb-2">
            <Quote className="h-3 w-3" />
            Reasoning
          </label>
          <div className={`p-3 rounded border text-sm leading-relaxed ${
            critique.match 
              ? 'border-[var(--color-success)]/30 bg-[var(--color-success)]/5 text-[var(--text-primary)]'
              : 'border-[var(--color-error)]/30 bg-[var(--color-error)]/5 text-[var(--text-primary)]'
          }`}>
            {critique.critique || 'No reasoning provided.'}
          </div>
        </div>

        {/* Suggestion (if available and mismatch) */}
        {!critique.match && critique.judgeValue !== undefined && critique.judgeValue !== critique.apiValue && (
          <div>
            <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-1 mb-2">
              <Lightbulb className="h-3 w-3" />
              Suggested Correction
            </label>
            <div className="p-3 rounded border border-[var(--color-success)]/30 bg-[var(--color-success)]/5">
              <p className="text-xs text-[var(--text-secondary)]">
                Update value to:
              </p>
              <pre className="text-sm font-mono text-[var(--color-success)] mt-1 whitespace-pre-wrap break-words">
                {formatDisplayValue(critique.judgeValue)}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Footer with summary */}
      <div className="px-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <p className="text-[9px] text-[var(--text-muted)]">
          {critique.match 
            ? '✓ Field value matches expected value'
            : `✗ Discrepancy detected (${critique.severity})`
          }
        </p>
      </div>
    </div>
  );
});
