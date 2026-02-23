import { useState, useMemo, memo, useCallback } from 'react';
import { ChevronDown, ChevronRight, CheckCircle, AlertTriangle, Check, X, Pencil } from 'lucide-react';
import { Card, Badge } from '@/components/ui';
import type { CritiqueSeverity, FieldCritique, FieldReviewItem, ReviewVerdict } from '@/types';

interface ApiStructuredComparisonProps {
  comparison?: {
    fields: FieldCritique[];
    overallAccuracy: number;
    summary: string;
  };
  reviewMode?: boolean;
  fieldReviews?: Map<string, FieldReviewItem>;
  onFieldReviewChange?: (fieldPath: string, review: FieldReviewItem) => void;
}

type SeverityFilter = 'all' | CritiqueSeverity;

const SEVERITY_CONFIG: Record<CritiqueSeverity, {
  variant: 'success' | 'primary' | 'warning' | 'error';
  label: string;
}> = {
  none: { variant: 'success', label: 'Match' },
  minor: { variant: 'primary', label: 'Minor' },
  moderate: { variant: 'warning', label: 'Moderate' },
  critical: { variant: 'error', label: 'Critical' },
};

/**
 * Render a field value (handles objects, nulls, primitives)
 */
function renderValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="italic text-[var(--text-tertiary)]">null</span>;
  }
  if (typeof value === 'object') {
    return <pre className="whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>;
  }
  return String(value);
}

/**
 * Verdict badge colors for read-only display
 */
const VERDICT_COLORS: Record<ReviewVerdict, string> = {
  accept: 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30',
  reject: 'bg-[var(--color-error)]/10 text-[var(--color-error)] border-[var(--color-error)]/30',
  correct: 'bg-[var(--color-info)]/10 text-[var(--color-info)] border-[var(--color-info)]/30',
};

/**
 * Human review cell for a field — verdict buttons + optional correction input
 */
const FieldReviewCell = memo(function FieldReviewCell({
  fieldPath,
  review,
  reviewMode,
  onReviewChange,
}: {
  fieldPath: string;
  review?: FieldReviewItem;
  reviewMode: boolean;
  onReviewChange?: (review: FieldReviewItem) => void;
}) {
  const [correctionText, setCorrectionText] = useState(
    review?.correctedValue != null ? String(review.correctedValue) : '',
  );

  const setVerdict = useCallback((verdict: ReviewVerdict) => {
    if (!onReviewChange) return;
    if (verdict === 'correct') {
      onReviewChange({ fieldPath, verdict, correctedValue: correctionText || null });
    } else {
      onReviewChange({ fieldPath, verdict });
    }
  }, [fieldPath, correctionText, onReviewChange]);

  const handleCorrectionBlur = useCallback(() => {
    if (!onReviewChange || review?.verdict !== 'correct') return;
    onReviewChange({ fieldPath, verdict: 'correct', correctedValue: correctionText || null });
  }, [fieldPath, correctionText, onReviewChange, review?.verdict]);

  if (!reviewMode) {
    if (!review) return <span className="text-[11px] text-[var(--text-muted)]">—</span>;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium ${VERDICT_COLORS[review.verdict]}`}>
        {review.verdict === 'accept' && <Check className="h-3 w-3" />}
        {review.verdict === 'reject' && <X className="h-3 w-3" />}
        {review.verdict === 'correct' && <Pencil className="h-3 w-3" />}
        {review.verdict}
      </span>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setVerdict('accept')}
          className={`p-1 rounded transition-colors ${
            review?.verdict === 'accept'
              ? 'bg-[var(--color-success)] text-white'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:bg-[var(--color-success)]/20 hover:text-[var(--color-success)]'
          }`}
          title="Accept"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setVerdict('reject')}
          className={`p-1 rounded transition-colors ${
            review?.verdict === 'reject'
              ? 'bg-[var(--color-error)] text-white'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:bg-[var(--color-error)]/20 hover:text-[var(--color-error)]'
          }`}
          title="Reject"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setVerdict('correct')}
          className={`p-1 rounded transition-colors ${
            review?.verdict === 'correct'
              ? 'bg-[var(--color-info)] text-white'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:bg-[var(--color-info)]/20 hover:text-[var(--color-info)]'
          }`}
          title="Correct"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
      {review?.verdict === 'correct' && (
        <input
          type="text"
          value={correctionText}
          onChange={(e) => setCorrectionText(e.target.value)}
          onBlur={handleCorrectionBlur}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCorrectionBlur(); }}
          placeholder="Corrected value…"
          className="w-full px-2 py-1 text-[11px] rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--color-info)]"
        />
      )}
    </div>
  );
});

/**
 * Single field row with expandable critique details
 */
const FieldRow = memo(function FieldRow({ field, reviewMode, review, onReviewChange }: {
  field: FieldCritique;
  reviewMode?: boolean;
  review?: FieldReviewItem;
  onReviewChange?: (review: FieldReviewItem) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const severity = field.severity || 'none';
  const config = SEVERITY_CONFIG[severity];
  const hasDetails = !field.match && field.critique;

  // Row background based on severity
  const rowBg = field.match
    ? ''
    : severity === 'critical'
    ? 'bg-[var(--color-error-light)]/30'
    : severity === 'moderate'
    ? 'bg-[var(--color-warning-light)]/30'
    : severity === 'minor'
    ? 'bg-[var(--color-info-light)]/20'
    : '';

  return (
    <div className={`border-b border-[var(--border-subtle)] transition-all duration-300 ${rowBg}`}>
      {/* Main row */}
      <div className={`grid ${reviewMode || review ? 'grid-cols-[1fr_1.5fr_1.5fr_100px_160px]' : 'grid-cols-[1fr_1.5fr_1.5fr_100px]'} gap-3 px-4 py-3 items-start`}>
        {/* Field path */}
        <div className="font-mono text-[11px] text-[var(--text-primary)] break-all pt-0.5">
          {field.fieldPath}
        </div>

        {/* API Value */}
        <div className="text-[11px] font-mono text-[var(--text-secondary)] break-words">
          {renderValue(field.apiValue)}
        </div>

        {/* Judge Value */}
        <div className="text-[11px] font-mono text-[var(--text-secondary)] break-words">
          {renderValue(field.judgeValue)}
        </div>

        {/* Severity & expand */}
        <div className="flex items-start gap-2">
          <Badge variant={config.variant} className="text-[9px]">
            {config.label}
          </Badge>
          {hasDetails && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          )}
        </div>

        {/* Review cell */}
        {(reviewMode || review) && (
          <FieldReviewCell
            fieldPath={field.fieldPath}
            review={review}
            reviewMode={!!reviewMode}
            onReviewChange={onReviewChange}
          />
        )}
      </div>

      {/* Expanded critique details */}
      {isExpanded && hasDetails && (
        <div className="px-4 pb-3 ml-[calc(1fr)]">
          <div className="rounded-md bg-[var(--bg-secondary)] border border-[var(--border-subtle)] p-3">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {field.confidence && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                  {field.confidence} confidence
                </span>
              )}
              {!field.match && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                  Severity: <strong>{severity}</strong>
                </span>
              )}
            </div>
            {/* Critique reasoning */}
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mb-2">
              {field.critique}
            </p>
            {/* Evidence snippet */}
            {field.evidenceSnippet && (
              <div className="mt-2 p-2 rounded bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20">
                <span className="text-[9px] font-medium text-[var(--color-warning)] uppercase tracking-wide">Evidence from transcript</span>
                <p className="text-[11px] text-[var(--text-primary)] mt-1 font-mono leading-relaxed">
                  "{field.evidenceSnippet}"
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export function ApiStructuredComparison({ comparison, reviewMode, fieldReviews, onFieldReviewChange }: ApiStructuredComparisonProps) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const showReviewColumn = reviewMode || (fieldReviews && fieldReviews.size > 0);

  // Defensive checks
  const fields = useMemo(() => comparison?.fields || [], [comparison?.fields]);
  const overallAccuracy = comparison?.overallAccuracy ?? 0;
  const summary = comparison?.summary || 'No summary available.';

  // Count by severity for filter badges
  const severityCounts = useMemo(() => {
    const counts = { none: 0, minor: 0, moderate: 0, critical: 0 };
    for (const field of fields) {
      const severity = field.match ? 'none' : (field.severity || 'none');
      counts[severity]++;
    }
    return counts;
  }, [fields]);

  // Filter fields
  const filteredFields = useMemo(() => {
    if (severityFilter === 'all') return fields;
    if (severityFilter === 'none') return fields.filter(f => f.match);
    return fields.filter(f => !f.match && f.severity === severityFilter);
  }, [fields, severityFilter]);

  return (
    <Card className="p-0 overflow-hidden">
      {/* Header with severity filter bar */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-[var(--text-primary)]">Structured Output Comparison</h4>
          <Badge
            variant={overallAccuracy >= 90 ? 'success' : overallAccuracy >= 70 ? 'warning' : 'error'}
            className="text-[9px]"
          >
            {overallAccuracy}% accuracy
          </Badge>
        </div>

        {/* Severity filter */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSeverityFilter('all')}
            className={`px-2 py-1 rounded text-[10px] transition-colors ${
              severityFilter === 'all'
                ? 'bg-[var(--color-brand-primary)] text-[var(--text-on-color)]'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
            }`}
          >
            All ({fields.length})
          </button>
          {severityCounts.critical > 0 && (
            <button
              onClick={() => setSeverityFilter('critical')}
              className={`px-2 py-1 rounded text-[10px] transition-colors ${
                severityFilter === 'critical'
                  ? 'bg-[var(--color-error)] text-[var(--text-on-color)]'
                  : 'bg-[var(--color-error-light)] text-[var(--color-error)] hover:bg-[var(--color-error)]/20'
              }`}
            >
              Critical ({severityCounts.critical})
            </button>
          )}
          {severityCounts.moderate > 0 && (
            <button
              onClick={() => setSeverityFilter('moderate')}
              className={`px-2 py-1 rounded text-[10px] transition-colors ${
                severityFilter === 'moderate'
                  ? 'bg-[var(--color-warning)] text-[var(--text-on-color)]'
                  : 'bg-[var(--color-warning-light)] text-[var(--color-warning)] hover:bg-[var(--color-warning)]/20'
              }`}
            >
              Moderate ({severityCounts.moderate})
            </button>
          )}
          {severityCounts.minor > 0 && (
            <button
              onClick={() => setSeverityFilter('minor')}
              className={`px-2 py-1 rounded text-[10px] transition-colors ${
                severityFilter === 'minor'
                  ? 'bg-[var(--color-info)] text-[var(--text-on-color)]'
                  : 'bg-[var(--color-info-light)] text-[var(--color-info)] hover:bg-[var(--color-info)]/20'
              }`}
            >
              Minor ({severityCounts.minor})
            </button>
          )}
          <button
            onClick={() => setSeverityFilter('none')}
            className={`px-2 py-1 rounded text-[10px] transition-colors ${
              severityFilter === 'none'
                ? 'bg-[var(--color-success)] text-[var(--text-on-color)]'
                : 'bg-[var(--color-success-light)] text-[var(--color-success)] hover:bg-[var(--color-success)]/20'
            }`}
          >
            Match ({severityCounts.none})
          </button>
        </div>
      </div>

      {/* Scrollable area: stats, summary, column headers (sticky), and field rows */}
      <div className="max-h-[500px] overflow-auto">

      {/* Statistics summary */}
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-2">
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <span className="text-[var(--text-muted)]">
            {fields.length} fields
          </span>
          <span className="flex items-center gap-1 text-[var(--color-success)]">
            <CheckCircle className="h-3 w-3" />
            {severityCounts.none} match
          </span>
          {severityCounts.minor > 0 && (
            <span className="text-[var(--color-info)]">
              {severityCounts.minor} minor
            </span>
          )}
          {severityCounts.moderate > 0 && (
            <span className="text-[var(--color-warning)]">
              {severityCounts.moderate} moderate
            </span>
          )}
          {severityCounts.critical > 0 && (
            <span className="flex items-center gap-1 text-[var(--color-error)]">
              <AlertTriangle className="h-3 w-3" />
              {severityCounts.critical} critical
            </span>
          )}
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-2.5">
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed line-clamp-3">{summary}</p>
        </div>
      )}

      {/* Column headers — sticky within scroll container */}
      <div className={`grid ${showReviewColumn ? 'grid-cols-[1fr_1.5fr_1.5fr_100px_160px]' : 'grid-cols-[1fr_1.5fr_1.5fr_100px]'} gap-3 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)] sticky top-0 z-10`}>
        <span className="text-[10px] font-medium text-[var(--text-muted)]">Field</span>
        <span className="text-[10px] font-medium text-[var(--text-muted)]">API Value</span>
        <span className="text-[10px] font-medium text-[var(--text-muted)]">Judge Value</span>
        <span className="text-[10px] font-medium text-[var(--text-muted)]">Status</span>
        {showReviewColumn && (
          <span className="text-[10px] font-medium text-[var(--text-muted)]">Review</span>
        )}
      </div>

      {/* Field rows */}
      <div>
        {filteredFields.length === 0 ? (
          <div className="px-4 py-8 text-center text-[var(--text-muted)] text-[13px]">
            No fields match the selected filter
          </div>
        ) : (
          filteredFields.map((field, idx) => (
            <FieldRow
              key={`${field.fieldPath}-${idx}`}
              field={field}
              reviewMode={reviewMode}
              review={fieldReviews?.get(field.fieldPath)}
              onReviewChange={onFieldReviewChange
                ? (review) => onFieldReviewChange(field.fieldPath, review)
                : undefined
              }
            />
          ))
        )}
      </div>
      </div>
    </Card>
  );
}
