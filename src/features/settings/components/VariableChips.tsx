import { memo, useMemo } from 'react';
import { Check, Clock, AlertCircle, Plus } from 'lucide-react';
import { cn } from '@/utils';
import { getAvailableVariables } from '@/services/templates';
import type { PromptType, TemplateVariableStatus } from '@/types';

interface VariableChipsProps {
  promptType: PromptType;
  promptText?: string; // The current prompt text to check if variable is in use
  variableStatuses?: Map<string, TemplateVariableStatus>;
  onInsert?: (variable: string) => void;
  className?: string;
  /** Show human-readable labels instead of raw variable keys */
  showLabels?: boolean;
  /** Show preview values where available */
  showValues?: boolean;
}

export const VariableChips = memo(function VariableChips({
  promptType,
  promptText = '',
  variableStatuses,
  onInsert,
  className,
  showLabels = true,
  showValues = true,
}: VariableChipsProps) {
  const availableVariables = getAvailableVariables(promptType);

  // Check which variables are currently in the prompt
  const variablesInPrompt = useMemo(() => {
    const inPrompt = new Set<string>();
    availableVariables.forEach((v) => {
      if (promptText.includes(v.key)) {
        inPrompt.add(v.key);
      }
    });
    return inPrompt;
  }, [promptText, availableVariables]);

  const getVariableIcon = (key: string) => {
    const isInPrompt = variablesInPrompt.has(key);
    const status = variableStatuses?.get(key);
    
    // Not in prompt - show plus icon to indicate it can be added
    if (!isInPrompt) {
      return <Plus className="h-3 w-3" />;
    }
    
    // In prompt - show status based on data availability
    if (!status || status.available) {
      return <Check className="h-3 w-3" />;
    }
    
    if (status.reason?.includes('not yet') || status.reason?.includes('Will be')) {
      return <Clock className="h-3 w-3" />;
    }
    
    return <AlertCircle className="h-3 w-3" />;
  };

  const getVariableStyles = (key: string) => {
    const isInPrompt = variablesInPrompt.has(key);
    const status = variableStatuses?.get(key);
    
    // Not in prompt - gray/neutral style (clickable to insert)
    if (!isInPrompt) {
      return 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-secondary)]';
    }
    
    // In prompt + no status or available - green success
    if (!status || status.available) {
      return 'bg-[var(--color-success-light)] text-[var(--color-success)] border-[var(--color-success)]/30';
    }
    
    // In prompt + pending (will be available later)
    if (status.reason?.includes('not yet') || status.reason?.includes('Will be')) {
      return 'bg-[var(--color-warning-light)] text-[var(--color-warning)] border-[var(--color-warning)]/30';
    }
    
    // In prompt + missing/error
    return 'bg-[var(--color-error-light)] text-[var(--color-error)] border-[var(--color-error)]/30';
  };

  const getTooltip = (key: string) => {
    const isInPrompt = variablesInPrompt.has(key);
    const status = variableStatuses?.get(key);
    const variable = availableVariables.find((v) => v.key === key);
    
    if (!isInPrompt) {
      return `Click to insert ${key}\n${variable?.description || ''}`;
    }
    
    if (status?.reason) {
      return `${status.available ? '✓' : '○'} ${status.reason}`;
    }
    
    return variable?.description || key;
  };

  // Extract a short preview value from status reason
  const getPreviewValue = (key: string): string | null => {
    const status = variableStatuses?.get(key);
    if (!status?.reason) return null;
    
    // Extract numbers (e.g., "24 segments" -> "24")
    const numMatch = status.reason.match(/^(\d+)/);
    if (numMatch) return numMatch[1];
    
    return null;
  };

  // Check if variable is required for this prompt type
  const isRequired = (key: string): boolean => {
    const variable = availableVariables.find((v) => v.key === key);
    return !!(variable?.required || variable?.requiredFor?.includes(promptType));
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="text-[11px] text-[var(--text-muted)]">Variables:</span>
      {availableVariables.map((variable) => {
        const previewValue = showValues ? getPreviewValue(variable.key) : null;
        const required = isRequired(variable.key);
        const isInPrompt = variablesInPrompt.has(variable.key);

        return (
          <button
            key={variable.key}
            onClick={() => onInsert?.(variable.key)}
            disabled={!onInsert}
            title={getTooltip(variable.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] border transition-colors',
              getVariableStyles(variable.key),
              onInsert && 'cursor-pointer',
              !onInsert && 'cursor-default'
            )}
          >
            {getVariableIcon(variable.key)}
            <span className={showLabels ? '' : 'font-mono'}>
              {showLabels ? variable.label : variable.key}
            </span>
            {/* Show preview value if available and in prompt */}
            {previewValue && isInPrompt && (
              <span className="font-mono text-[10px] opacity-75">
                ({previewValue})
              </span>
            )}
            {/* Show required badge if not in prompt */}
            {required && !isInPrompt && (
              <span className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded bg-[var(--color-warning)]/20 text-[var(--color-warning)]">
                Req
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
});
