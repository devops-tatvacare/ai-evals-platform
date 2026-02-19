import { useMemo } from 'react';
import { Table2 } from 'lucide-react';
import { cn } from '@/utils';
import { REQUIRED_FIELDS, type CsvPreviewResult } from '../utils/csvSchema';

interface CsvDataPreviewProps {
  preview: CsvPreviewResult;
  /** Column mapping applied — shows remapped target names as column tips */
  columnMapping?: Map<string, string>;
}

/**
 * Inline scrollable table preview of the first N rows of uploaded CSV data.
 * Headers that match required schema fields get a subtle highlight.
 */
export function CsvDataPreview({ preview, columnMapping }: CsvDataPreviewProps) {
  const { headers, rows, totalRowCount } = preview;

  // Build a set of mapped target names for header highlighting
  const mappedTargets = useMemo(() => {
    if (!columnMapping) return new Set<string>();
    const targets = new Set<string>();
    for (const [, source] of columnMapping) {
      targets.add(source.toLowerCase());
    }
    return targets;
  }, [columnMapping]);

  const requiredSet = useMemo(() => new Set(REQUIRED_FIELDS.map((f) => f.toLowerCase())), []);

  if (headers.length === 0 || rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Table2 className="h-3.5 w-3.5 text-[var(--text-muted)]" />
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">
          Data Preview
        </span>
        <span className="text-[11px] text-[var(--text-muted)]">
          {rows.length} of {totalRowCount.toLocaleString()} rows
        </span>
      </div>

      <div className="rounded-lg border border-[var(--border-default)] overflow-hidden">
        <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
          <table className="w-full text-[11px] border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[var(--bg-secondary)]">
                <th className="px-2.5 py-2 text-left text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border-subtle)] w-8 shrink-0">
                  #
                </th>
                {headers.map((header, i) => {
                  const isRequired = requiredSet.has(header.toLowerCase());
                  const isMapped = mappedTargets.has(header.toLowerCase());
                  return (
                    <th
                      key={i}
                      className={cn(
                        'px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wider border-b border-[var(--border-subtle)] whitespace-nowrap',
                        isRequired
                          ? 'text-[var(--color-info)]'
                          : isMapped
                            ? 'text-[var(--color-warning)]'
                            : 'text-[var(--text-muted)]'
                      )}
                    >
                      <code className="font-mono">{header}</code>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className="hover:bg-[var(--bg-secondary)]/50 transition-colors"
                >
                  <td className="px-2.5 py-1.5 text-[var(--text-tertiary)] font-mono border-b border-[var(--border-subtle)] tabular-nums">
                    {rowIdx + 1}
                  </td>
                  {row.map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className="px-2.5 py-1.5 text-[var(--text-primary)] border-b border-[var(--border-subtle)] max-w-[200px] truncate"
                      title={cell}
                    >
                      {cell || <span className="text-[var(--text-tertiary)] italic">empty</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
