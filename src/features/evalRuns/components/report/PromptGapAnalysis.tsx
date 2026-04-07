import { useState, Fragment } from 'react';
import { Lightbulb } from 'lucide-react';
import type { NarrativeOutput } from '@/types/reports';
import { cn } from '@/utils/cn';
import SectionHeader from './shared/SectionHeader';
import SegmentedBar from './shared/SegmentedBar';
import { GAP_TYPE_COLORS, GAP_TYPE_DOT_COLORS, verdictLabel } from './shared/colors';
import { PROMPT_GAP_INFO } from './sectionInfo';

interface Props {
  narrative: NarrativeOutput | null;
}

const GAP_TYPE_ORDER = ['UNDERSPEC', 'SILENT', 'LEAKAGE', 'CONFLICTING'];

const GAP_TYPE_DESCRIPTIONS: Record<string, string> = {
  UNDERSPEC: 'Prompt lacks explicit guidance on behavior that evaluation rules expect.',
  SILENT: 'Prompt doesn\'t address a rule at all — expected behavior is neither required nor prohibited.',
  LEAKAGE: 'Internal evaluation criteria are leaking into the prompt, potentially biasing the agent.',
  CONFLICTING: 'Prompt actively contradicts what evaluation rules require.',
};

export default function PromptGapAnalysis({ narrative }: Props) {
  const gaps = narrative?.promptGaps ?? [];
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (i: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  if (gaps.length === 0) {
    return (
      <section>
        <SectionHeader
          title="Prompt Gap Analysis"
          description="Where production prompts may be missing or conflicting with evaluation rules"
          infoTooltip={<PROMPT_GAP_INFO />}
        />
        <p className="text-sm text-[var(--text-muted)] italic">
          AI analysis not available for prompt gaps.
        </p>
      </section>
    );
  }

  // Count gaps by type for summary bar
  const typeCounts: Record<string, number> = {};
  for (const gap of gaps) {
    typeCounts[gap.gapType] = (typeCounts[gap.gapType] ?? 0) + 1;
  }

  const summarySegments = GAP_TYPE_ORDER
    .filter((t) => (typeCounts[t] ?? 0) > 0)
    .map((t) => ({
      label: `${verdictLabel(t)}: ${typeCounts[t]}`,
      value: typeCounts[t],
      color: GAP_TYPE_DOT_COLORS[t] ?? 'var(--color-verdict-na)',
    }));

  return (
    <section>
      <SectionHeader
        title="Prompt Gap Analysis"
        description="Where production prompts may be missing or conflicting with evaluation rules"
        infoTooltip={<PROMPT_GAP_INFO />}
      />

      {/* Gap type summary bar */}
      <div className="mb-4">
        <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
          Gap Types: {gaps.length} gap{gaps.length !== 1 ? 's' : ''} found
        </p>
        <SegmentedBar
          segments={summarySegments}
          barHeight="h-2"
          showValues={false}
          showLegendValues={false}
        />
      </div>

      {/* Gap type legend */}
      <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
        {GAP_TYPE_ORDER.filter((t) => (typeCounts[t] ?? 0) > 0).map((t) => (
          <div key={t} className="flex items-start gap-2">
            <span
              className="mt-1 w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: GAP_TYPE_DOT_COLORS[t] ?? 'var(--color-verdict-na)' }}
            />
            <p className="text-xs text-[var(--text-secondary)] leading-snug">
              <span className="font-semibold text-[var(--text-primary)]">{verdictLabel(t)}</span>
              {' \u2014 '}
              {GAP_TYPE_DESCRIPTIONS[t]}
            </p>
          </div>
        ))}
      </div>

      {/* Table with expandable fix rows */}
      <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-[var(--border-subtle)]">
              <th style={{ width: 12 }} className="px-2 py-1.5" />
              <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                Prompt Section
              </th>
              <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                Rule
              </th>
              <th className="px-2 py-1.5" />
              <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                Description
              </th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((gap, i) => {
              const isExpanded = expandedRows.has(i);
              const gapStyle = GAP_TYPE_COLORS[gap.gapType] ?? { bg: 'bg-gray-100', text: 'text-gray-800' };

              return (
                <Fragment key={i}>
                  <tr
                    onClick={() => toggleRow(i)}
                    className={cn(
                      'cursor-pointer transition-colors',
                      i % 2 === 0 ? 'bg-[var(--bg-primary)]' : 'bg-[var(--bg-secondary)]',
                      !isExpanded && 'hover:bg-[var(--bg-tertiary)]',
                    )}
                  >
                    <td className="px-2 py-2.5">
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ backgroundColor: GAP_TYPE_DOT_COLORS[gap.gapType] ?? 'var(--color-verdict-na)' }}
                      />
                    </td>
                    <td className="px-2 py-2.5 font-medium text-[var(--text-primary)]">
                      {gap.promptSection || (
                        <span className="italic text-[var(--text-muted)]">(no section)</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 font-mono text-xs text-[var(--text-secondary)]">
                      {gap.evalRule}
                    </td>
                    <td className="px-2 py-2.5">
                      <span
                        className={cn(
                          'inline-block px-1.5 py-px text-[9px] font-semibold rounded-full whitespace-nowrap',
                          gapStyle.bg,
                          gapStyle.text,
                        )}
                      >
                        {gap.gapType}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-[var(--text-secondary)] text-xs">
                      {gap.description}
                    </td>
                  </tr>

                  {/* Expanded fix row (visible on screen when expanded; always visible in print) */}
                  {gap.suggestedFix && (
                    <tr className={cn('prompt-gap-detail', !isExpanded && 'hidden')}>
                      <td
                        colSpan={5}
                        className="px-2 py-2 bg-[var(--bg-secondary)] border-t border-dashed border-[var(--border-subtle)]"
                      >
                        <div
                          className="flex items-start gap-2 px-3 py-2 bg-[var(--surface-info)] rounded-md border-l-[3px] text-xs text-[var(--text-secondary)] leading-relaxed ml-4"
                          style={{ borderLeftColor: 'var(--color-info)' }}
                        >
                          <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[var(--color-info)]" />
                          <span>{gap.suggestedFix}</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-[var(--text-muted)] mt-2 italic">
        Click any row to reveal the suggested fix.
      </p>
    </section>
  );
}
