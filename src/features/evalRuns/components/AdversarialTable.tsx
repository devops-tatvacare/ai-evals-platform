import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, ChevronLeft, ChevronRight } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import type { AdversarialEvalRow } from '@/types';
import VerdictBadge from './VerdictBadge';
import { routes } from '@/config/routes';
import { humanize, normalizeLabel } from '@/utils/evalFormatters';

interface Props {
  evaluations: AdversarialEvalRow[];
  runId: string;
}

type SortDir = 'asc' | 'desc';
type SortKey = 'goal_flow' | 'difficulty' | 'total_turns' | 'goal_achieved' | 'verdict';

const PAGE_SIZE = 25;

const DIFFICULTY_RANK: Record<string, number> = { EASY: 0, MEDIUM: 1, HARD: 2 };
const VERDICT_RANK: Record<string, number> = { PASS: 0, 'SOFT FAIL': 1, 'HARD FAIL': 2, CRITICAL: 3 };

function SortHeader({ label, k, sortKey, sortDir, onToggle }: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onToggle: (key: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th
      onClick={() => onToggle(k)}
      className={`text-left px-2.5 py-2 text-xs uppercase tracking-wider cursor-pointer select-none whitespace-nowrap border-b-2 border-[var(--border-subtle)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] focus-visible:ring-offset-1 ${
        active ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {label}
      {active && <span className="ml-1 text-[0.6rem]">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>}
    </th>
  );
}

export default function AdversarialTable({ evaluations, runId }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('goal_flow');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const arr = [...evaluations];
    arr.sort((a, b) => {
      let cmp = 0;

      switch (sortKey) {
        case 'goal_flow':
          cmp = (a.goal_flow || []).join(',').localeCompare((b.goal_flow || []).join(','));
          break;
        case 'difficulty':
          cmp = (DIFFICULTY_RANK[a.difficulty] ?? 99) - (DIFFICULTY_RANK[b.difficulty] ?? 99);
          break;
        case 'total_turns':
          cmp = a.total_turns - b.total_turns;
          break;
        case 'goal_achieved':
          cmp = Number(a.goal_achieved) - Number(b.goal_achieved);
          break;
        case 'verdict': {
          const ra = a.verdict ? (VERDICT_RANK[normalizeLabel(a.verdict)] ?? 5) : 99;
          const rb = b.verdict ? (VERDICT_RANK[normalizeLabel(b.verdict)] ?? 5) : 99;
          cmp = ra - rb;
          break;
        }
      }

      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [evaluations, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const safePage = totalPages > 0 ? Math.min(page, totalPages - 1) : 0;
  const paged = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    setPage(0);
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
        <table className="w-full border-collapse bg-[var(--bg-primary)]">
          <thead className="sticky top-0 z-10 bg-[var(--bg-primary)]">
            <tr>
              <SortHeader label="Goal Flow" k="goal_flow" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Difficulty" k="difficulty" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Turns" k="total_turns" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Goal" k="goal_achieved" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Verdict" k="verdict" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {paged.map((ae) => (
              <tr
                key={ae.id}
                className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-secondary)] transition-colors"
              >
                <td className="px-2.5 py-2 text-sm font-semibold text-[var(--text-primary)]">
                  <Link
                    to={routes.kaira.adversarialDetail(runId, String(ae.id))}
                    className="text-[var(--text-brand)] hover:underline"
                  >
                    {(ae.goal_flow || []).map(humanize).join(' → ')}
                  </Link>
                </td>
                <td className="px-2.5 py-2">
                  <VerdictBadge verdict={ae.difficulty} category="difficulty" />
                </td>
                <td className="px-2.5 py-2 text-sm text-[var(--text-secondary)]">
                  {ae.total_turns}
                </td>
                <td className="px-2.5 py-2 text-center text-sm">
                  {ae.goal_achieved ? (
                    <span className="text-[var(--color-success)]">{'\u2713'}</span>
                  ) : (
                    <span className="text-[var(--color-error)]">{'\u2717'}</span>
                  )}
                </td>
                <td className="px-2.5 py-2">
                  {ae.verdict != null ? (
                    <VerdictBadge verdict={ae.verdict} category="adversarial" />
                  ) : (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold text-white"
                      style={{ backgroundColor: 'var(--color-error)' }}
                    >
                      Failed
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="p-3">
                  <EmptyState
                    icon={ClipboardList}
                    title="No adversarial tests found"
                    compact
                    className="border-none"
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer: count + pagination */}
      <div className="flex items-center justify-between mt-1.5">
        <p className="text-xs text-[var(--text-muted)]">
          Showing {sorted.length === 0 ? 0 : safePage * PAGE_SIZE + 1}-{Math.min((safePage + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={`min-w-[28px] h-7 px-1.5 text-xs font-medium rounded transition-colors ${safePage === i
                  ? 'bg-[var(--interactive-primary)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                {i + 1}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage === totalPages - 1}
              className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
