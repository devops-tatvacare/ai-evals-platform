import { CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { Badge, ModelBadge } from '@/components/ui';
import type { AIEvaluation } from '@/types';

interface AIEvalStatusProps {
  evaluation: AIEvaluation;
  onRerun?: () => void;
}

export function AIEvalStatus({ evaluation }: AIEvalStatusProps) {
  const getStatusIcon = () => {
    switch (evaluation.status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-[var(--color-error)]" />;
      case 'processing':
        return <Clock className="h-4 w-4 text-[var(--color-warning)] animate-pulse" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-[var(--text-muted)]" />;
    }
  };

  const getStatusLabel = () => {
    switch (evaluation.status) {
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      case 'processing':
        return 'Processing';
      default:
        return 'Pending';
    }
  };

  const getMatchBadgeVariant = (percentage: number): 'success' | 'warning' | 'error' => {
    if (percentage >= 90) return 'success';
    if (percentage >= 70) return 'warning';
    return 'error';
  };

  // Calculate match percentage from critique statistics
  const stats = evaluation.critique?.statistics;
  const matchPercentage = stats && stats.totalSegments > 0
    ? (stats.matchCount / stats.totalSegments) * 100
    : null;
  
  // Count issues by severity
  const issueCount = stats 
    ? stats.criticalCount + stats.moderateCount + stats.minorCount
    : 0;

  // Compact horizontal strip layout
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
      {/* Status */}
      <div className="flex items-center gap-2">
        {getStatusIcon()}
        <Badge variant={evaluation.status === 'completed' ? 'success' : 'neutral'} className="text-[10px]">
          {getStatusLabel()}
        </Badge>
      </div>
      
      {/* Separator */}
      <div className="h-4 w-px bg-[var(--border-default)]" />
      
      {/* Model */}
      <ModelBadge modelName={evaluation.model} variant="inline" />
      
      {/* Metrics (only show if completed with statistics) */}
      {evaluation.status === 'completed' && matchPercentage !== null && (
        <>
          <div className="h-4 w-px bg-[var(--border-default)]" />
          
          {/* Match Score */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)]">Match:</span>
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">
              {matchPercentage.toFixed(1)}%
            </span>
            <Badge variant={getMatchBadgeVariant(matchPercentage)} className="text-[9px]">
              {matchPercentage >= 90
                ? 'Excellent'
                : matchPercentage >= 70
                  ? 'Good'
                  : 'Review'}
            </Badge>
          </div>
          
          {/* Issues count */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--text-muted)]">Issues:</span>
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">
              {issueCount}
            </span>
            {stats && stats.criticalCount > 0 && (
              <Badge variant="error" className="text-[9px]">
                {stats.criticalCount} critical
              </Badge>
            )}
          </div>
        </>
      )}
      
      {/* Error state */}
      {evaluation.status === 'failed' && evaluation.error && (
        <>
          <div className="h-4 w-px bg-[var(--border-default)]" />
          <span className="text-[11px] text-[var(--color-error)] truncate max-w-[200px]">
            {evaluation.error}
          </span>
        </>
      )}
      
      {/* Timestamp - pushed to right */}
      <span className="ml-auto text-[10px] text-[var(--text-muted)]">
        {new Date(evaluation.createdAt).toLocaleString()}
      </span>
    </div>
  );
}
