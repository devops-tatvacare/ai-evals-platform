import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui';
import { cn } from '@/utils';
import type { HistoryScores } from '@/types';

interface ScoreDisplayProps {
  scores: HistoryScores | null;
  className?: string;
}

export function ScoreDisplay({ scores, className }: ScoreDisplayProps) {
  const [reasoningExpanded, setReasoningExpanded] = useState(false);

  if (!scores) {
    return (
      <div className={cn("text-sm text-[var(--text-muted)]", className)}>
        No score available
      </div>
    );
  }

  const scoreType = detectScoreType(scores.overall_score);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Overall Score */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
          Overall Score
        </div>
        {renderScore(scores.overall_score, scores.max_score, scoreType)}
      </div>

      {/* Breakdown */}
      {scores.breakdown && Object.keys(scores.breakdown).length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
            Breakdown
          </div>
          <div className="space-y-2">
            {Object.entries(scores.breakdown).map(([key, value]) => {
              const breakdownType = detectScoreType(value);
              return (
                <div key={key} className="space-y-1">
                  <div className="text-xs text-[var(--text-secondary)]">
                    {key.replace(/_/g, ' ')}
                  </div>
                  {renderScore(value, null, breakdownType)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Reasoning */}
      {scores.reasoning && (
        <div className="space-y-2">
          <button
            onClick={() => setReasoningExpanded(!reasoningExpanded)}
            className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide hover:text-[var(--text-primary)] transition-colors"
          >
            Reasoning
            {reasoningExpanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
          {reasoningExpanded && (
            <div className="text-sm text-[var(--text-primary)] leading-relaxed bg-[var(--bg-secondary)] rounded-md p-3 border border-[var(--border-subtle)]">
              {scores.reasoning}
            </div>
          )}
        </div>
      )}

      {/* Metadata */}
      {scores.metadata && Object.keys(scores.metadata).length > 0 && (
        <div className="pt-2 border-t border-[var(--border-subtle)]">
          <div className="text-xs text-[var(--text-muted)] space-y-1">
            {Object.entries(scores.metadata).map(([key, value]) => (
              <div key={key} className="flex justify-between">
                <span>{key.replace(/_/g, ' ')}:</span>
                <span className="font-mono">{JSON.stringify(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type ScoreType = 'numeric' | 'percentage' | 'boolean' | 'categorical' | 'unknown';

function detectScoreType(value: unknown): ScoreType {
  if (typeof value === 'number') {
    // Check if it looks like a percentage (0-100 range or explicit max_score of 100)
    return value >= 0 && value <= 100 ? 'percentage' : 'numeric';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'string') {
    // Categorical values like "good", "excellent", "poor"
    const categoricalValues = ['excellent', 'good', 'fair', 'poor', 'pass', 'fail', 'low', 'medium', 'high'];
    if (categoricalValues.includes(value.toLowerCase())) {
      return 'categorical';
    }
  }
  return 'unknown';
}

function renderScore(value: unknown, maxScore: number | null, type: ScoreType) {
  switch (type) {
    case 'numeric':
      return <NumericScore value={value as number} maxScore={maxScore} />;
    case 'percentage':
      return <PercentageScore value={value as number} />;
    case 'boolean':
      return <BooleanScore value={value as boolean} />;
    case 'categorical':
      return <CategoricalScore value={value as string} />;
    default:
      return (
        <div className="font-mono text-sm text-[var(--text-primary)]">
          {JSON.stringify(value)}
        </div>
      );
  }
}

function NumericScore({ value, maxScore }: { value: number; maxScore: number | null }) {
  const max = maxScore || 10;
  const percentage = (value / max) * 100;
  const color = getColorForPercentage(percentage);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className={cn("text-2xl font-bold", color.text)}>
          {value.toFixed(2)}
        </span>
        {maxScore !== null && (
          <span className="text-sm text-[var(--text-muted)]">
            / {maxScore}
          </span>
        )}
      </div>
      <div className="h-2 w-full bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color.bar)}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}

function PercentageScore({ value }: { value: number }) {
  const color = getColorForPercentage(value);

  return (
    <div className="space-y-2">
      <div className={cn("text-2xl font-bold", color.text)}>
        {value.toFixed(1)}%
      </div>
      <div className="h-2 w-full bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color.bar)}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}

function BooleanScore({ value }: { value: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {value ? (
        <>
          <div className="h-5 w-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
          </div>
          <span className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
            PASS
          </span>
        </>
      ) : (
        <>
          <div className="h-5 w-5 rounded-full bg-red-500/20 flex items-center justify-center">
            <div className="h-2 w-2 rounded-full bg-red-500" />
          </div>
          <span className="text-lg font-semibold text-red-600 dark:text-red-400">
            FAIL
          </span>
        </>
      )}
    </div>
  );
}

function CategoricalScore({ value }: { value: string }) {
  const variant = getCategoricalVariant(value.toLowerCase());

  return (
    <Badge variant={variant} className="text-sm px-3 py-1">
      {value.toUpperCase()}
    </Badge>
  );
}

function getColorForPercentage(percentage: number) {
  if (percentage >= 90) {
    return {
      text: 'text-emerald-600 dark:text-emerald-400',
      bar: 'bg-emerald-500',
    };
  }
  if (percentage >= 70) {
    return {
      text: 'text-green-600 dark:text-green-400',
      bar: 'bg-green-500',
    };
  }
  if (percentage >= 50) {
    return {
      text: 'text-amber-600 dark:text-amber-400',
      bar: 'bg-amber-500',
    };
  }
  return {
    text: 'text-red-600 dark:text-red-400',
    bar: 'bg-red-500',
  };
}

function getCategoricalVariant(value: string): 'default' | 'success' | 'warning' | 'destructive' {
  const lowerValue = value.toLowerCase();
  
  if (['excellent', 'pass', 'high', 'good'].includes(lowerValue)) {
    return 'success';
  }
  if (['fair', 'medium', 'moderate'].includes(lowerValue)) {
    return 'warning';
  }
  if (['poor', 'fail', 'low'].includes(lowerValue)) {
    return 'destructive';
  }
  return 'default';
}
