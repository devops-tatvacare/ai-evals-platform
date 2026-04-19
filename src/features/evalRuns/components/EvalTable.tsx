import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { DataTable, type ColumnDef, type SortState } from '@/components/ui/DataTable';
import {
  InlineReviewControls,
  useInlineReviewNavigationGuard,
  useInlineReviewOptional,
} from '@/features/reviews/inline';
import type { ThreadEvalRow, EvaluatorDescriptor, ReviewableItem } from '@/types';
import VerdictBadge from './VerdictBadge';
import { pct, normalizeLabel } from '@/utils/evalFormatters';
import { routes } from '@/config/routes';

interface Props {
  evaluations: ThreadEvalRow[];
  evaluatorDescriptors?: EvaluatorDescriptor[];
  /** Set of thread IDs that have been human-reviewed */
  reviewedThreadIds?: Set<string>;
  /** Map of threadId → attributeKey → reviewedValue for before→after chips on verdict cells */
  humanVerdicts?: Map<string, Map<string, string>>;
  reviewableItems?: Map<string, ReviewableItem>;
}

const DEFAULT_PAGE_SIZE = 25;

const CORRECTNESS_RANK: Record<string, number> = {
  PASS: 0, 'NOT APPLICABLE': 1, 'SOFT FAIL': 2, 'HARD FAIL': 3, CRITICAL: 4,
};

const EFFICIENCY_RANK: Record<string, number> = {
  EFFICIENT: 0, ACCEPTABLE: 1, INCOMPLETE: 2, FRICTION: 3, BROKEN: 4,
};

const DEFAULT_DESCRIPTORS: EvaluatorDescriptor[] = [
  {
    id: 'intent',
    name: 'Judge Intent Acc',
    type: 'built-in',
    primaryField: { key: 'intent_accuracy', format: 'percentage' },
  },
  {
    id: 'correctness',
    name: 'Correctness',
    type: 'built-in',
    primaryField: { key: 'worst_correctness', format: 'verdict' },
  },
  {
    id: 'efficiency',
    name: 'Efficiency',
    type: 'built-in',
    primaryField: { key: 'efficiency_verdict', format: 'verdict' },
  },
];

function getRank(value: string | null, ranks: Record<string, number>): number {
  if (!value) return 99;
  return ranks[normalizeLabel(value)] ?? 5;
}

function StatusBadge({ status }: { status: 'failed' | 'skipped' }) {
  const isFailed = status === 'failed';
  return (
    <span
      className={`inline-block rounded-full px-1.5 py-px text-[10px] font-semibold tracking-wide leading-snug ${
        isFailed
          ? 'bg-[var(--color-error)] text-white'
          : 'bg-[var(--text-muted)] text-white opacity-60'
      }`}
    >
      {isFailed ? 'Failed' : 'Skipped'}
    </span>
  );
}

export function getCellValue(
  evaluation: ThreadEvalRow,
  desc: EvaluatorDescriptor,
): { value: unknown; state: 'ok' | 'failed' | 'skipped' } {
  const result = evaluation.result as unknown as Record<string, unknown> | undefined;

  if (desc.type === 'built-in') {
    const failedEvals = (result?.failed_evaluators ?? {}) as Record<string, string>;
    const skippedEvals = (result?.skipped_evaluators ?? []) as string[];

    if (failedEvals[desc.id]) return { value: null, state: 'failed' };
    if (skippedEvals.includes(desc.id)) return { value: null, state: 'skipped' };

    switch (desc.primaryField?.key) {
      case 'intent_accuracy': return { value: evaluation.intent_accuracy, state: 'ok' };
      case 'worst_correctness': return { value: evaluation.worst_correctness, state: 'ok' };
      case 'efficiency_verdict': return { value: evaluation.efficiency_verdict, state: 'ok' };
      default: return { value: null, state: 'ok' };
    }
  }

  const customEvals = (result?.custom_evaluations ?? {}) as Record<string, {
    status: string;
    output?: Record<string, unknown>;
    error?: string;
  }>;

  const ce = customEvals[desc.id];
  if (!ce) return { value: null, state: 'skipped' };
  if (ce.status === 'failed') return { value: null, state: 'failed' };

  const primaryKey = desc.primaryField?.key;
  if (primaryKey && ce.output) {
    return { value: ce.output[primaryKey], state: 'ok' };
  }

  return { value: null, state: 'ok' };
}

function CellRenderer({ desc, value, humanVerdict }: { desc: EvaluatorDescriptor; value: unknown; humanVerdict?: string }) {
  if (value == null) return <span className="text-[var(--text-muted)]">{'\u2014'}</span>;

  switch (desc.primaryField?.format) {
    case 'percentage': {
      const num = Number(value);
      return <span className="text-sm font-medium">{pct(num)}</span>;
    }
    case 'verdict':
      return (
        <VerdictBadge
          verdict={String(value)}
          humanVerdict={humanVerdict}
          category={desc.type === 'built-in' ? (desc.id as 'correctness' | 'efficiency' | 'intent') : 'correctness'}
        />
      );
    case 'number': {
      const num = Number(value);
      const display = num <= 1 ? `${(num * 100).toFixed(0)}%` : String(num);
      return <span className="text-sm font-medium">{display}</span>;
    }
    case 'boolean':
      return value
        ? <span className="text-[var(--color-success)]">Pass</span>
        : <span className="text-[var(--color-error)]">Fail</span>;
    default:
      return <span className="text-sm truncate max-w-[100px]">{String(value)}</span>;
  }
}

function getMsgCount(te: ThreadEvalRow): number {
  const r = te.result as unknown as Record<string, unknown> | undefined;
  const thread = r?.thread as { message_count?: number; messages?: unknown[] } | undefined;
  return thread?.message_count ?? (thread?.messages as unknown[])?.length ?? 0;
}

function customSortValue(
  te: ThreadEvalRow,
  evalId: string,
  descriptors: EvaluatorDescriptor[],
): number | string {
  const result = te.result as unknown as Record<string, unknown> | undefined;
  const customEvals = (result?.custom_evaluations ?? {}) as Record<string, Record<string, unknown>>;
  const ce = customEvals[evalId];
  if (!ce || ce.status !== 'completed' || !ce.output) return '';
  const desc = descriptors.find((d) => d.id === evalId);
  const primaryKey = desc?.primaryField?.key;
  if (primaryKey) {
    const output = ce.output as Record<string, unknown>;
    const val = output[primaryKey];
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return val;
    if (typeof val === 'boolean') return val ? 1 : 0;
  }
  return '';
}

export default function EvalTable({
  evaluations,
  evaluatorDescriptors,
  reviewedThreadIds,
  humanVerdicts,
  reviewableItems,
}: Props) {
  const descriptors = evaluatorDescriptors ?? DEFAULT_DESCRIPTORS;
  const navigate = useNavigate();
  const review = useInlineReviewOptional();
  const { confirmNavigation, guardModal } = useInlineReviewNavigationGuard();
  const [sortState, setSortState] = useState<SortState>({ key: 'thread_id', order: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const showReviewSummaryColumn = !!reviewedThreadIds;
  const showReviewColumns = !!review && !!reviewableItems && reviewableItems.size > 0;

  const sorted = useMemo(() => {
    const arr = [...evaluations];
    arr.sort((a, b) => {
      let cmp = 0;
      const key = sortState.key;

      if (key === 'thread_id') {
        cmp = a.thread_id.localeCompare(b.thread_id);
      } else if (key === 'message_count') {
        cmp = getMsgCount(a) - getMsgCount(b);
      } else if (key === 'success_status') {
        cmp = a.success_status - b.success_status;
      } else if (key === 'intent_accuracy') {
        cmp = (a.intent_accuracy ?? 0) - (b.intent_accuracy ?? 0);
      } else if (key === 'worst_correctness') {
        cmp = getRank(a.worst_correctness, CORRECTNESS_RANK) - getRank(b.worst_correctness, CORRECTNESS_RANK);
      } else if (key === 'efficiency_verdict') {
        cmp = getRank(a.efficiency_verdict, EFFICIENCY_RANK) - getRank(b.efficiency_verdict, EFFICIENCY_RANK);
      } else if (key.startsWith('custom_')) {
        const evalId = key.slice(7);
        const valA = customSortValue(a, evalId, descriptors);
        const valB = customSortValue(b, evalId, descriptors);
        if (typeof valA === 'number' && typeof valB === 'number') {
          cmp = valA - valB;
        } else {
          cmp = String(valA).localeCompare(String(valB));
        }
      }

      return sortState.order === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [evaluations, sortState, descriptors]);

  const totalItems = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const columns = useMemo((): ColumnDef<ThreadEvalRow>[] => {
    const cols: ColumnDef<ThreadEvalRow>[] = [
      {
        key: 'thread_id',
        header: 'Thread ID',
        sortable: true,
        width: 'min-w-[180px]',
        render: (e) => (
          <Link
            to={routes.kaira.threadDetail(e.thread_id)}
            className="font-mono text-sm text-[var(--text-brand)] hover:underline"
            onClick={(ev) => ev.stopPropagation()}
          >
            {e.thread_id}
          </Link>
        ),
      },
      {
        key: 'message_count',
        header: 'Msgs',
        sortable: true,
        width: 'w-[70px]',
        headerClassName: 'text-right',
        cellClassName: 'text-right',
        render: (e) => (
          <span className="text-sm text-[var(--text-secondary)]">{getMsgCount(e)}</span>
        ),
      },
    ];

    for (const desc of descriptors) {
      const sortKey =
        desc.type === 'built-in' ? desc.primaryField?.key ?? desc.id : `custom_${desc.id}`;
      cols.push({
        key: sortKey,
        header: desc.name,
        sortable: true,
        width: 'min-w-[140px]',
        render: (e) => {
          const { value, state } = getCellValue(e, desc);
          const attrKey = desc.primaryField?.key;
          const reviewableItem = reviewableItems?.get(e.thread_id);
          const attr = attrKey && reviewableItem
            ? reviewableItem.attributes.find((a) => a.key === attrKey)
            : undefined;
          const edit = attr && reviewableItem
            ? review?.getEdit(reviewableItem.itemKey, attr.key)
            : undefined;
          return (
            <div
              className="flex items-center gap-1"
              onClick={(ev) => {
                if (attr && review?.isEditing) ev.stopPropagation();
              }}
            >
              {state === 'failed' ? (
                <StatusBadge status="failed" />
              ) : state === 'skipped' ? (
                <StatusBadge status="skipped" />
              ) : (
                <CellRenderer
                  desc={desc}
                  value={value}
                  humanVerdict={
                    desc.primaryField?.key
                      ? humanVerdicts?.get(e.thread_id)?.get(desc.primaryField.key)
                      : undefined
                  }
                />
              )}
              {showReviewColumns && review?.isEditing && attr && reviewableItem && (
                <InlineReviewControls
                  decision={edit?.decision}
                  note={edit?.note}
                  originalValue={attr.originalValue}
                  reviewedValue={edit?.reviewedValue}
                  allowedValues={attr.allowedValues}
                  onReject={() => review.acceptAttribute(reviewableItem, attr)}
                  onOverride={(v) => review.correctAttribute(reviewableItem, attr, v)}
                  onNote={(n) => review.setAttributeNote(reviewableItem, attr, n)}
                  onClear={() => review.clearAttribute(reviewableItem, attr)}
                />
              )}
            </div>
          );
        },
      });
    }

    cols.push({
      key: 'success_status',
      header: 'Completed',
      sortable: true,
      width: 'w-[90px]',
      headerClassName: 'text-center',
      cellClassName: 'text-center',
      render: (e) =>
        e.success_status ? (
          <span className="text-[var(--color-success)]">{'\u2713'}</span>
        ) : (
          <span className="text-[var(--color-error)]">{'\u2717'}</span>
        ),
    });

    if (showReviewSummaryColumn) {
      cols.push({
        key: 'human_review',
        header: 'Human Review',
        width: 'w-[110px]',
        render: (e) =>
          reviewedThreadIds!.has(e.thread_id) ? (
            <span className="text-[11px] font-semibold text-[var(--text-brand)]">Yes</span>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]">No</span>
          ),
      });
    }

    return cols;
  }, [descriptors, reviewableItems, reviewedThreadIds, showReviewColumns, showReviewSummaryColumn, humanVerdicts, review]);

  return (
    <>
      <DataTable
        columns={columns}
        data={paged}
        keyExtractor={(row) => String(row.id)}
        onRowClick={(row) => {
          const target = routes.kaira.threadDetail(row.thread_id);
          // Threads belonging to this review's scope are still inside the
          // review — dirty edits are shared via reviewModeStore, so there's
          // nothing to save before navigating. Only guard out-of-scope rows
          // (e.g. threads that have no reviewable attributes).
          if (reviewableItems?.has(row.thread_id)) {
            navigate(target);
            return;
          }
          confirmNavigation(() => navigate(target));
        }}
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
        emptyTitle="No evaluations found"
      />
      {guardModal}
    </>
  );
}
