import { cn } from '@/utils';
import { providerIcons, providerLabels, detectProvider, type LLMProvider } from './providers';

export type ModelBadgeVariant = 'inline' | 'compact' | 'full';

interface ModelBadgeProps {
  /** Model name/ID to display */
  modelName: string;
  /** Optional display name (friendly name) - used in 'full' variant */
  displayName?: string;
  /** LLM provider - auto-detected from modelName if not provided */
  provider?: LLMProvider;
  /** Visual variant */
  variant?: ModelBadgeVariant;
  /** Show "powered by" prefix (only for compact variant) */
  showPoweredBy?: boolean;
  /** Show "Active" pill (only for full variant) */
  isActive?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Unified model display component with consistent styling across the app.
 * 
 * Variants:
 * - `inline`: Minimal - icon + model name (for metadata rows)
 * - `compact`: Small with optional "powered by" prefix
 * - `full`: Card-like with display name, model ID, and optional Active badge
 */
export function ModelBadge({
  modelName,
  displayName,
  provider,
  variant = 'inline',
  showPoweredBy = false,
  isActive = false,
  className,
}: ModelBadgeProps) {
  const detectedProvider = provider ?? detectProvider(modelName);
  const iconSrc = providerIcons[detectedProvider];
  const providerLabel = providerLabels[detectedProvider];
  
  // Determine what name to show
  const primaryName = displayName || modelName;
  const secondaryName = displayName && displayName !== modelName ? modelName : null;

  if (variant === 'inline') {
    return (
      <span className={cn('inline-flex items-center gap-1.5', className)}>
        <img 
          src={iconSrc} 
          alt={providerLabel} 
          className="h-3 w-3 shrink-0" 
        />
        <span className="text-[11px] text-[var(--text-muted)]">
          {modelName}
        </span>
      </span>
    );
  }

  if (variant === 'compact') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]', className)}>
        {showPoweredBy && <span>powered by</span>}
        <img 
          src={iconSrc} 
          alt={providerLabel} 
          className="h-3 w-3 shrink-0" 
        />
        <span>{modelName}</span>
      </span>
    );
  }

  // variant === 'full'
  return (
    <div 
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-[var(--radius-default)]',
        'bg-[var(--bg-secondary)] border border-[var(--border-subtle)]',
        className
      )}
    >
      <img 
        src={iconSrc} 
        alt={providerLabel} 
        className="h-4 w-4 shrink-0" 
      />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-[var(--text-primary)] truncate">
          {primaryName}
        </p>
        {secondaryName && (
          <p className="text-[10px] text-[var(--text-muted)] truncate">
            {secondaryName}
          </p>
        )}
      </div>
      {isActive && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-brand-accent)]/10 text-[var(--color-brand-primary)] font-medium shrink-0">
          Active
        </span>
      )}
    </div>
  );
}
