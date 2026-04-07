import { ArrowRight } from 'lucide-react';
import type { CustomEvaluationsReport } from '@/types/reports';
import { METRIC_HEX } from '../shared/colors';

interface Props {
  report: CustomEvaluationsReport;
  onNavigate?: () => void;
}

export default function CustomSummaryCard({ report, onNavigate }: Props) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Custom Evaluations</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {report.evaluatorSections.map((section) => {
          const primary = section.primaryField;
          let displayValue: string | null = null;
          let color = 'var(--color-verdict-na)';

          if (primary) {
            if (primary.fieldType === 'number' && primary.average != null) {
              displayValue = primary.average.toFixed(1);
              color = METRIC_HEX(primary.average);
            } else if (primary.fieldType === 'boolean' && primary.passRate != null) {
              const pct = primary.passRate * 100;
              displayValue = `${pct.toFixed(0)}%`;
              color = METRIC_HEX(pct);
            } else if (primary.fieldType === 'enum' && primary.distribution) {
              const sorted = Object.entries(primary.distribution).sort((a, b) => b[1] - a[1]);
              if (sorted.length > 0) {
                displayValue = sorted[0][0];
                color = 'var(--color-info)';
              }
            }
          }

          return (
            <div
              key={section.evaluatorId}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 overflow-hidden"
            >
              <div className="h-0.5 -mx-3 -mt-3 mb-2" style={{ backgroundColor: color }} />
              <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{section.evaluatorName}</p>
              {displayValue && (
                <p className="text-lg font-bold mt-1" style={{ color }}>
                  {displayValue}
                </p>
              )}
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                {section.completed}/{section.totalThreads} threads
              </p>
            </div>
          );
        })}
      </div>

      {onNavigate && (
        <button
          onClick={onNavigate}
          className="inline-flex items-center gap-1 mt-3 text-xs font-medium text-[var(--text-brand)] hover:underline"
        >
          View Details
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
