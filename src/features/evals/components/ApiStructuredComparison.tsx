import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertCircle, CheckCircle, Info } from 'lucide-react';
import type { ApiEvaluationCritique } from '@/types';

interface ApiStructuredComparisonProps {
  comparison: ApiEvaluationCritique['structuredComparison'];
}

export function ApiStructuredComparison({ comparison }: ApiStructuredComparisonProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showMatchingFields, setShowMatchingFields] = useState(false);

  const severityColors = {
    none: 'text-[var(--color-success)]',
    minor: 'text-[var(--color-warning)]',
    moderate: 'text-orange-500',
    critical: 'text-[var(--color-error)]',
  };

  const severityLabels = {
    none: 'Match',
    minor: 'Minor',
    moderate: 'Moderate',
    critical: 'Critical',
  };

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy >= 90) return 'text-[var(--color-success)]';
    if (accuracy >= 70) return 'text-[var(--color-warning)]';
    return 'text-[var(--color-error)]';
  };

  const displayFields = showMatchingFields 
    ? comparison.fields 
    : comparison.fields.filter(f => !f.match);

  const matchCount = comparison.fields.filter(f => f.match).length;
  const mismatchCount = comparison.fields.length - matchCount;

  return (
    <div className="border border-[var(--border-primary)] rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[var(--text-secondary)]" />
          )}
          <span className="font-medium text-[var(--text-primary)]">Structured Output Comparison</span>
          <span className="text-xs text-[var(--text-secondary)]">
            ({mismatchCount} discrepancies, {matchCount} matches)
          </span>
        </div>
        <span className={`text-sm font-medium ${getAccuracyColor(comparison.overallAccuracy)}`}>
          {comparison.overallAccuracy}% accuracy
        </span>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Summary */}
          {comparison.summary && (
            <div className="p-3 bg-[var(--bg-secondary)] rounded border border-[var(--border-secondary)]">
              <p className="text-sm text-[var(--text-primary)]">{comparison.summary}</p>
            </div>
          )}

          {/* Filter toggle */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={showMatchingFields}
                onChange={(e) => setShowMatchingFields(e.target.checked)}
                className="rounded"
              />
              Show matching fields
            </label>
            <Info className="h-3 w-3 text-[var(--text-tertiary)]" />
          </div>

          {/* Field-by-field table */}
          <div className="overflow-auto border border-[var(--border-secondary)] rounded">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-secondary)]">
                <tr className="border-b border-[var(--border-secondary)]">
                  <th className="text-left p-3 font-medium text-[var(--text-primary)] w-48">Field</th>
                  <th className="text-left p-3 font-medium text-[var(--text-primary)]">API Value</th>
                  <th className="text-left p-3 font-medium text-[var(--text-primary)]">Judge Value</th>
                  <th className="text-center p-3 font-medium text-[var(--text-primary)] w-24">Status</th>
                  <th className="text-left p-3 font-medium text-[var(--text-primary)]">Critique</th>
                </tr>
              </thead>
              <tbody>
                {displayFields.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-[var(--text-secondary)]">
                      {showMatchingFields ? 'No fields to display' : 'No discrepancies found'}
                    </td>
                  </tr>
                ) : (
                  displayFields.map((field, idx) => (
                    <tr 
                      key={idx} 
                      className="border-b border-[var(--border-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                      <td className="p-3 font-mono text-xs text-[var(--text-primary)] align-top">
                        {field.fieldPath}
                      </td>
                      <td className="p-3 max-w-xs align-top">
                        <div className="text-xs font-mono text-[var(--text-secondary)] break-words">
                          {field.apiValue === null || field.apiValue === undefined
                            ? <span className="italic text-[var(--text-tertiary)]">null</span>
                            : typeof field.apiValue === 'object'
                            ? <pre className="whitespace-pre-wrap">{JSON.stringify(field.apiValue, null, 2)}</pre>
                            : String(field.apiValue)}
                        </div>
                      </td>
                      <td className="p-3 max-w-xs align-top">
                        <div className="text-xs font-mono text-[var(--text-secondary)] break-words">
                          {field.judgeValue === null || field.judgeValue === undefined
                            ? <span className="italic text-[var(--text-tertiary)]">null</span>
                            : typeof field.judgeValue === 'object'
                            ? <pre className="whitespace-pre-wrap">{JSON.stringify(field.judgeValue, null, 2)}</pre>
                            : String(field.judgeValue)}
                        </div>
                      </td>
                      <td className="p-3 align-top">
                        <div className="flex flex-col items-center gap-1">
                          {field.match ? (
                            <>
                              <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />
                              <span className="text-xs text-[var(--color-success)]">Match</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className={`h-4 w-4 ${severityColors[field.severity]}`} />
                              <span className={`text-xs ${severityColors[field.severity]}`}>
                                {severityLabels[field.severity]}
                              </span>
                            </>
                          )}
                          {field.confidence && (
                            <span className="text-xs text-[var(--text-tertiary)] capitalize">
                              {field.confidence}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-xs text-[var(--text-secondary)] align-top max-w-md">
                        {field.critique || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
