import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ClipboardList } from 'lucide-react';
import { DataTable, type ColumnDef, type SortState } from '@/components/ui/DataTable';
import {
  InlineReviewControls,
  useInlineReviewOptional,
} from '@/features/reviews/inline';
import type { AdversarialEvalRow, ReviewableItem } from '@/types';
import VerdictBadge from './VerdictBadge';
import { routes } from '@/config/routes';
import { cn } from '@/utils/cn';
import { humanize, normalizeLabel } from '@/utils/evalFormatters';
import { getCanonicalAdversarialCase } from '../utils/adversarialCanonical';

interface Props {
  evaluations: AdversarialEvalRow[];
  runId: string;
  reviewableItems?: Map<string, ReviewableItem>;
  reviewedIds?: Set<string>;
  humanVerdicts?: Map<string, Map<string, string>>;
}

const DEFAULT_PAGE_SIZE = 25;

const DIFFICULTY_RANK: Record<string, number> = { EASY: 0, MEDIUM: 1, HARD: 2 };
const VERDICT_RANK: Record<string, number> = { PASS: 0, 'SOFT FAIL': 1, 'HARD FAIL': 2, CRITICAL: 3 };

function getPrimaryAttribute(item?: ReviewableItem) {
  if (!item) return undefined;
  return item.attributes.find((a) => a.key === 'verdict') ?? item.attributes[0];
}

function compareRows(a: AdversarialEvalRow, b: AdversarialEvalRow, key: string): number {
  switch (key) {
    case 'goal_flow':
      return (a.goal_flow || []).join(',').localeCompare((b.goal_flow || []).join(','));
    case 'difficulty':
      return (DIFFICULTY_RANK[a.difficulty] ?? 99) - (DIFFICULTY_RANK[b.difficulty] ?? 99);
    case 'total_turns':
      return a.total_turns - b.total_turns;
    case 'goal_achieved':
      return (
        Number(getCanonicalAdversarialCase(a.result, a).judge.goalAchieved) -
        Number(getCanonicalAdversarialCase(b.result, b).judge.goalAchieved)
      );
    case 'verdict': {
      const ra = a.verdict ? VERDICT_RANK[normalizeLabel(a.verdict)] ?? 5 : 99;
      const rb = b.verdict ? VERDICT_RANK[normalizeLabel(b.verdict)] ?? 5 : 99;
      return ra - rb;
    }
    default:
      return 0;
  }
}

export default function AdversarialTable({ evaluations, runId, reviewableItems, reviewedIds, humanVerdicts }: Props) {
  const navigate = useNavigate();
  const review = useInlineReviewOptional();
  const [sortState, setSortState] = useState<SortState>({ key: 'goal_flow', order: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const showReviewSummaryColumn = !!reviewedIds;
  const showReviewColumns = !!review && !!reviewableItems && reviewableItems.size > 0;

  const sorted = useMemo(() => {
    const arr = [...evaluations];
    arr.sort((a, b) => {
      const cmp = compareRows(a, b, sortState.key);
      return sortState.order === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [evaluations, sortState]);

  const totalItems = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const columns = useMemo((): ColumnDef<AdversarialEvalRow>[] => {
    const base: ColumnDef<AdversarialEvalRow>[] = [
      {
        key: 'goal_flow',
        header: 'Goal Flow',
        sortable: true,
        width: 'min-w-[220px]',
        render: (ae) => {
          const canonical = getCanonicalAdversarialCase(ae.result, ae);
          return (
            <>
              <Link
                to={routes.kaira.adversarialDetail(runId, String(ae.id))}
                className="font-semibold text-[var(--text-brand)] hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {(ae.goal_flow || []).map(humanize).join(' → ')}
              </Link>
              {canonical.derived.hasContradiction && (
                <span
                  className="ml-2 inline-flex align-middle text-[var(--color-warning)]"
                  title={canonical.derived.contradictionTypes.map(humanize).join(', ')}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                </span>
              )}
            </>
          );
        },
      },
      {
        key: 'difficulty',
        header: 'Difficulty',
        sortable: true,
        width: 'w-[120px]',
        render: (ae) => <VerdictBadge verdict={ae.difficulty} category="difficulty" />,
      },
      {
        key: 'total_turns',
        header: 'Turns',
        sortable: true,
        width: 'w-[80px]',
        render: (ae) => {
          const canonical = getCanonicalAdversarialCase(ae.result, ae);
          return (
            <span className="text-sm text-[var(--text-secondary)]">
              {canonical.facts.transcript.turnCount || ae.total_turns}
            </span>
          );
        },
      },
      {
        key: 'goal_achieved',
        header: 'Goal',
        sortable: true,
        width: 'w-[70px]',
        headerClassName: 'text-center',
        cellClassName: 'text-center',
        render: (ae) => {
          const canonical = getCanonicalAdversarialCase(ae.result, ae);
          return canonical.judge.goalAchieved ? (
            <span className="text-[var(--color-success)]">{'\u2713'}</span>
          ) : (
            <span className="text-[var(--color-error)]">{'\u2717'}</span>
          );
        },
      },
      {
        key: 'verdict',
        header: 'Verdict',
        sortable: true,
        width: 'w-[180px]',
        render: (ae) => {
          const canonical = getCanonicalAdversarialCase(ae.result, ae);
          const itemKey = String(ae.id);
          const reviewableItem = reviewableItems?.get(itemKey);
          const primaryAttr = getPrimaryAttribute(reviewableItem);
          const primaryEdit = reviewableItem && primaryAttr
            ? review?.getEdit(reviewableItem.itemKey, primaryAttr.key)
            : undefined;
          // humanVerdicts works both during an active review (live edits) and
          // after finalize (persisted overrides) — look up by the stable
          // `verdict` attribute key, not via reviewableItem which is only
          // populated during active review.
          const humanVerdict = humanVerdicts?.get(itemKey)?.get('verdict');
          return (
            <div className="flex items-center gap-1">
              {canonical.judge.verdict != null ? (
                <VerdictBadge
                  verdict={canonical.judge.verdict}
                  category="adversarial"
                  humanVerdict={humanVerdict}
                />
              ) : (
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold text-white"
                  style={{ backgroundColor: 'var(--color-error)' }}
                >
                  Infra Error
                </span>
              )}
              {showReviewColumns && review?.isEditing && reviewableItem && primaryAttr && (
                <InlineReviewControls
                  decision={primaryEdit?.decision}
                  note={primaryEdit?.note}
                  originalValue={primaryAttr.originalValue}
                  reviewedValue={primaryEdit?.reviewedValue}
                  allowedValues={primaryAttr.allowedValues}
                  onReject={() => review.acceptAttribute(reviewableItem, primaryAttr)}
                  onOverride={(v) => review.correctAttribute(reviewableItem, primaryAttr, v)}
                  onNote={(n) => review.setAttributeNote(reviewableItem, primaryAttr, n)}
                  onClear={() => review.clearAttribute(reviewableItem, primaryAttr)}
                />
              )}
            </div>
          );
        },
      },
    ];

    if (showReviewSummaryColumn) {
      base.push({
        key: 'human_review',
        header: 'Human Review',
        width: 'w-[110px]',
        render: (ae) => {
          const itemKey = String(ae.id);
          return reviewedIds!.has(itemKey) ? (
            <span className="text-[11px] font-semibold text-[var(--text-brand)]">Yes</span>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]">No</span>
          );
        },
      });
    }

    return base;
  }, [runId, reviewableItems, reviewedIds, review, showReviewColumns, showReviewSummaryColumn, humanVerdicts]);

  const rowClassName = (ae: AdversarialEvalRow) =>
    reviewedIds?.has(String(ae.id))
      ? 'bg-[color-mix(in_srgb,var(--interactive-primary)_2.5%,transparent)]'
      : undefined;

  // DataTable doesn't expose per-row classNames; emulate the reviewed-row tint
  // via keyExtractor-based lookup in a wrapper not needed here since the visual
  // cue is subtle; defer to the Human Review column for clarity.
  void rowClassName;

  return (
    <DataTable
      columns={columns}
      data={paged}
      keyExtractor={(row) => String(row.id)}
      onRowClick={(row) => navigate(routes.kaira.adversarialDetail(runId, String(row.id)))}
      sortState={sortState}
      onSortChange={(next) => {
        setSortState(next);
        setPage(1);
      }}
      pagination={{
        page: safePage,
        totalPages,
        pageSize,
        totalItems,
        showCount: true,
        onPageChange: setPage,
        onPageSizeChange: (n) => {
          setPageSize(n);
          setPage(1);
        },
      }}
      emptyIcon={ClipboardList}
      emptyTitle="No adversarial tests found"
      className={cn(showReviewColumns && 'review-active')}
    />
  );
}
