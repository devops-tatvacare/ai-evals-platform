import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { History, Loader2 } from 'lucide-react';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { Avatar } from '@/components/ui/Avatar';
import { DiffPill } from '@/components/ui/DiffPill';
import { BeforeAfterChip } from '@/features/reviews/inline/BeforeAfterChip';
import { fetchReviewDetail } from '@/services/api/reviewsApi';
import { useRunReviewMeta } from '@/features/reviews/reviewOverridesStore';
import type { EvalReviewSummary, EvalReviewDetail, ReviewItemRecord } from '@/types/reviews';

interface ReviewHistoryTabProps {
  runId: string;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function itemKey(item: Pick<ReviewItemRecord, 'itemKey' | 'attributeKey'>): string {
  return `${item.itemKey}::${item.attributeKey}`;
}

function summarize(review: EvalReviewSummary): string {
  const snap = review.reviewSnapshot as { reviewedItems?: number; corrected?: number; accepted?: number; rejected?: number } | null;
  if (!snap) return `${review.overallDecision ?? 'reviewed'}`;
  const parts: string[] = [];
  if (snap.corrected) parts.push(`${snap.corrected} corrected`);
  if (snap.accepted) parts.push(`${snap.accepted} accepted`);
  if (snap.rejected) parts.push(`${snap.rejected} rejected`);
  if (parts.length === 0 && snap.reviewedItems) parts.push(`${snap.reviewedItems} item${snap.reviewedItems === 1 ? '' : 's'}`);
  return parts.join(', ') || 'no items';
}

function snapshotCount(review: EvalReviewSummary): number {
  const snap = review.reviewSnapshot as { reviewedItems?: number } | null;
  return snap?.reviewedItems ?? 0;
}

export function ReviewHistoryTab({ runId }: ReviewHistoryTabProps) {
  const { history, loaded } = useRunReviewMeta(runId);

  // Finalized reviews only in the history table.
  const finalized = useMemo(
    () => history.filter((r) => r.status === 'final'),
    [history],
  );

  const [details, setDetails] = useState<Map<string, EvalReviewDetail>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [errorIds, setErrorIds] = useState<Set<string>>(new Set());

  const fetchDetail = useCallback((reviewId: string) => {
    setDetails((prev) => {
      if (prev.has(reviewId)) return prev;
      return prev;
    });
    setLoadingIds((prev) => {
      if (prev.has(reviewId)) return prev;
      const next = new Set(prev);
      next.add(reviewId);
      return next;
    });
    fetchReviewDetail(reviewId)
      .then((detail) => {
        setDetails((prev) => {
          if (prev.has(reviewId)) return prev;
          const next = new Map(prev);
          next.set(reviewId, detail);
          return next;
        });
      })
      .catch(() => {
        setErrorIds((prev) => {
          const next = new Set(prev);
          next.add(reviewId);
          return next;
        });
      })
      .finally(() => {
        setLoadingIds((prev) => {
          if (!prev.has(reviewId)) return prev;
          const next = new Set(prev);
          next.delete(reviewId);
          return next;
        });
      });
  }, []);

  // When rows expand we need both the row's detail and the previous (older)
  // review's detail to build the diff. Defer the previous fetch — only fire
  // it when the user actually expands a row.
  useEffect(() => {
    if (!loaded) return;
    // no-op: we fetch on demand inside renderExpandedRow
  }, [loaded]);

  const finalizedOrder = useMemo(
    () => finalized.map((r) => r.id),
    [finalized],
  );

  const findPreviousReviewId = useCallback(
    (reviewId: string): string | null => {
      // history is ordered desc (newest first). "Previous" = next index.
      const idx = finalizedOrder.indexOf(reviewId);
      if (idx < 0) return null;
      return finalizedOrder[idx + 1] ?? null;
    },
    [finalizedOrder],
  );

  const columns: ColumnDef<EvalReviewSummary>[] = useMemo(() => [
    {
      key: 'reviewer',
      header: 'Reviewer',
      width: '24%',
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <Avatar name={row.reviewerName} size="md" />
          <span className="flex flex-col leading-tight">
            <span className="font-semibold text-[var(--text-primary)]">
              {row.reviewerName ?? '—'}
            </span>
            <span className="text-[11px] text-[var(--text-secondary)]">
              {row.overallDecision ?? 'final'}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'finalized_at',
      header: 'Finalized',
      width: '18%',
      render: (row) => (
        <span className="text-[var(--text-primary)]">{formatDateTime(row.completedAt)}</span>
      ),
    },
    {
      key: 'summary',
      header: 'Summary',
      render: (row) => (
        <span className="text-[var(--text-secondary)] text-[12px]">{summarize(row)}</span>
      ),
    },
    {
      key: 'vs_prev',
      header: 'Changed from previous',
      width: '20%',
      render: (row) => {
        const prevId = findPreviousReviewId(row.id);
        if (!prevId) return <DiffPill kind="initial">initial review</DiffPill>;
        return <DiffPill kind="new">supersedes earlier review</DiffPill>;
      },
    },
    {
      key: 'items',
      header: 'Items',
      width: '80px',
      render: (row) => (
        <span className="font-semibold text-[var(--text-primary)] tabular-nums">
          {snapshotCount(row)}
        </span>
      ),
    },
  ], [findPreviousReviewId]);

  const renderExpandedRow = useCallback((row: EvalReviewSummary): ReactNode => {
    // Lazy-load current + previous detail on first expand.
    if (!details.has(row.id) && !loadingIds.has(row.id) && !errorIds.has(row.id)) {
      fetchDetail(row.id);
    }
    const prevId = findPreviousReviewId(row.id);
    if (prevId && !details.has(prevId) && !loadingIds.has(prevId) && !errorIds.has(prevId)) {
      fetchDetail(prevId);
    }

    const current = details.get(row.id);
    const previous = prevId ? details.get(prevId) ?? null : null;

    if (!current) {
      return (
        <div className="flex items-center gap-2 p-6 text-[12px] text-[var(--text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
          Loading review items…
        </div>
      );
    }

    const prevIndex = new Map<string, ReviewItemRecord>();
    if (previous) {
      for (const it of previous.items) prevIndex.set(itemKey(it), it);
    }

    return (
      <ReviewItemsTable
        current={current}
        previousIndex={prevIndex}
        hasPrevious={!!prevId}
        previousLoading={!!prevId && loadingIds.has(prevId)}
      />
    );
  }, [details, loadingIds, errorIds, fetchDetail, findPreviousReviewId]);

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 p-6 text-[12px] text-[var(--text-secondary)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
        Loading review history…
      </div>
    );
  }

  return (
    <DataTable<EvalReviewSummary>
      data={finalized}
      columns={columns}
      keyExtractor={(r) => r.id}
      renderExpandedRow={renderExpandedRow}
      emptyIcon={History}
      emptyTitle="No finalized reviews yet"
      emptyDescription="Once a reviewer finalizes a draft, their changes appear here."
      minWidth="880px"
      stickyHeader={false}
    />
  );
}

function ReviewItemsTable({
  current,
  previousIndex,
  hasPrevious,
  previousLoading,
}: {
  current: EvalReviewDetail;
  previousIndex: Map<string, ReviewItemRecord>;
  hasPrevious: boolean;
  previousLoading: boolean;
}) {
  if (current.items.length === 0) {
    return (
      <div className="p-6 text-[12px] text-[var(--text-secondary)]">
        No item-level decisions recorded for this review.
      </div>
    );
  }

  return (
    <div className="px-4 py-4 bg-[var(--bg-secondary)] border-t border-[var(--border-subtle)]">
      <table className="w-full text-[12px] border border-[var(--border-subtle)] rounded-md overflow-hidden bg-[var(--bg-elevated)]">
        <thead>
          <tr className="bg-[var(--bg-tertiary)] text-left text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
            <th className="px-3 py-2 font-semibold">Scope</th>
            <th className="px-3 py-2 font-semibold">Attribute</th>
            <th className="px-3 py-2 font-semibold">Before → After</th>
            <th className="px-3 py-2 font-semibold">Changed from previous</th>
            <th className="px-3 py-2 font-semibold">Decision</th>
          </tr>
        </thead>
        <tbody>
          {current.items.map((item) => {
            const prev = previousIndex.get(itemKey(item));
            return (
              <tr key={item.id} className="border-t border-[var(--border-subtle)] align-top">
                <td className="px-3 py-2">
                  <div className="font-semibold text-[var(--text-primary)]">{item.itemType}: {item.itemKey}</div>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)]">
                  {item.attributeKey}
                </td>
                <td className="px-3 py-2">
                  {item.decision === 'correct' && item.reviewedValue ? (
                    <BeforeAfterChip
                      before={item.originalValue ?? '—'}
                      after={item.reviewedValue}
                    />
                  ) : (
                    <span className="text-[var(--text-secondary)]">
                      {item.decision === 'accept' ? 'accepted AI verdict' : 'rejected'}
                    </span>
                  )}
                  {item.note && (
                    <div className="mt-1 italic text-[11px] text-[var(--text-secondary)]">"{item.note}"</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <PrevDiff item={item} prev={prev} hasPrevious={hasPrevious} previousLoading={previousLoading} />
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex rounded-full border border-[var(--chip-brand-border)] bg-[var(--chip-brand-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--chip-brand-text)]">
                    {item.decision}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PrevDiff({
  item,
  prev,
  hasPrevious,
  previousLoading,
}: {
  item: ReviewItemRecord;
  prev: ReviewItemRecord | undefined;
  hasPrevious: boolean;
  previousLoading: boolean;
}) {
  if (!hasPrevious) return <DiffPill kind="initial">initial review</DiffPill>;
  if (previousLoading && !prev) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
        <Loader2 className="h-3 w-3 animate-spin" /> comparing…
      </span>
    );
  }
  if (!prev) return <DiffPill kind="new">new this review</DiffPill>;
  const sameDecision = prev.decision === item.decision;
  const sameValue =
    (prev.reviewedValue ?? null) === (item.reviewedValue ?? null);
  if (sameDecision && sameValue) return <DiffPill kind="same">same as previous</DiffPill>;
  return (
    <DiffPill kind="changed">
      was {prev.decision === 'correct' ? (prev.reviewedValue ?? '—') : prev.decision}
    </DiffPill>
  );
}
