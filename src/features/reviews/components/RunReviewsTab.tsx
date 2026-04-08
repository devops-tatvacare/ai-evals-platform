import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FilePenLine, History, PencilLine, Save, Search, SendHorizontal, Trash2, XCircle } from 'lucide-react';
import { Button, Input, Pagination, Select } from '@/components/ui';
import type { LabelCategory } from '@/config/labelDefinitions';
import { useAppConfig } from '@/hooks';
import VerdictBadge from '@/features/evalRuns/components/VerdictBadge';
import { getRuleOutcomeMeta } from '@/features/evalRuns/utils/ruleCompliance';
import {
  createRunReviewDraft,
  discardReviewDraft,
  fetchReviewDetail,
  fetchRunReviewContext,
  finalizeReview,
  saveReviewDraft,
} from '@/services/api/reviewsApi';
import { notificationService } from '@/services/notifications';
import type {
  EvalReviewDetail,
  ReviewDraftUpdate,
  ReviewItemRecord,
  ReviewItemUpsert,
  ReviewableAttribute,
  ReviewableItem,
  RunReviewContext,
} from '@/types';
import { formatTimestamp } from '@/utils/evalFormatters';
import { cn } from '@/utils/cn';

interface RunReviewsTabProps {
  appId: 'voice-rx' | 'kaira-bot' | 'inside-sales';
  runId: string;
}

interface ReviewEditState {
  itemKey: string;
  itemType: string;
  attributeKey: string;
  decision: '' | 'accept' | 'reject' | 'correct';
  originalValue: string | null;
  reviewedValue: string | null;
  reasonCode: string | null;
  note: string | null;
}

const THREAD_PAGE_SIZE = 24;
const UNSET_DECISION_VALUE = '__pending__';
const UNSET_REASON_VALUE = '__no_reason__';

const DECISION_OPTIONS = [
  { value: UNSET_DECISION_VALUE, label: 'Not reviewed' },
  { value: 'accept', label: 'Accept AI label' },
  { value: 'reject', label: 'Reject AI label' },
  { value: 'correct', label: 'Correct label' },
];

const REASON_OPTIONS = [
  { value: UNSET_REASON_VALUE, label: 'No reason tag' },
  { value: 'wrong-label', label: 'Wrong label' },
  { value: 'missing-context', label: 'Missing context' },
  { value: 'needs-human-judgment', label: 'Needs human judgment' },
  { value: 'policy-override', label: 'Policy override' },
];

function reviewKey(itemKey: string, attributeKey: string): string {
  return `${itemKey}::${attributeKey}`;
}

function buildEditMap(review: EvalReviewDetail | null): Record<string, ReviewEditState> {
  if (!review) return {};
  return review.items.reduce<Record<string, ReviewEditState>>((acc, item) => {
    acc[reviewKey(item.itemKey, item.attributeKey)] = {
      itemKey: item.itemKey,
      itemType: item.itemType,
      attributeKey: item.attributeKey,
      decision: item.decision,
      originalValue: item.originalValue,
      reviewedValue: item.reviewedValue,
      reasonCode: item.reasonCode,
      note: item.note,
    };
    return acc;
  }, {});
}

function toPayload(notes: string, edits: Record<string, ReviewEditState>): ReviewDraftUpdate {
  const items: ReviewItemUpsert[] = Object.values(edits)
    .filter((item): item is ReviewEditState & { decision: 'accept' | 'reject' | 'correct' } => item.decision !== '')
    .map((item) => ({
      itemKey: item.itemKey,
      itemType: item.itemType,
      attributeKey: item.attributeKey,
      decision: item.decision,
      originalValue: item.originalValue,
      reviewedValue: item.decision === 'correct' ? item.reviewedValue : null,
      reasonCode: item.reasonCode,
      note: item.note,
    }));

  return { notes, items };
}

function decisionTone(decision: string | null | undefined): string {
  if (decision === 'accept') return 'text-[var(--color-success)]';
  if (decision === 'reject') return 'text-[var(--color-error)]';
  if (decision === 'correct') return 'text-[var(--text-brand)]';
  return 'text-[var(--text-muted)]';
}

function decisionLabel(record: ReviewItemRecord | ReviewEditState | undefined): string {
  if (!record || record.decision === '') return 'Pending';
  if (record.decision === 'accept') return 'Accepted';
  if (record.decision === 'reject') return 'Rejected';
  return 'Corrected';
}

function formatValueLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ');
}

function summarizeTone(summary: string): string {
  if (summary === 'Accepted') return 'bg-[var(--color-success)]';
  if (summary === 'Rejected') return 'bg-[var(--color-error)]';
  if (summary === 'Corrected') return 'bg-[var(--text-brand)]';
  if (summary === 'In progress') return 'bg-[var(--color-warning)]';
  return 'bg-[var(--border-default)]';
}

function summaryBadgeClass(summary: string): string {
  if (summary === 'Accepted') {
    return 'border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)]';
  }
  if (summary === 'Rejected') {
    return 'border-[var(--color-error)]/30 bg-[color-mix(in_srgb,var(--color-error)_12%,transparent)] text-[var(--color-error)]';
  }
  if (summary === 'Corrected') {
    return 'border-[var(--border-brand)] bg-[var(--surface-brand-subtle)] text-[var(--text-brand)]';
  }
  if (summary === 'In progress') {
    return 'border-[var(--border-warning)] bg-[var(--surface-warning)] text-[var(--color-warning)]';
  }
  return 'border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)]';
}

function summarizeItem(item: ReviewableItem, edits: Record<string, ReviewEditState>): string {
  const states = item.attributes
    .map((attribute) => edits[reviewKey(item.itemKey, attribute.key)])
    .filter(Boolean);
  if (states.length === 0) return 'Unreviewed';
  if (states.some((state) => state?.decision === 'correct')) return 'Corrected';
  if (states.some((state) => state?.decision === 'reject')) return 'Rejected';
  if (states.every((state) => state?.decision === 'accept')) return 'Accepted';
  return 'In progress';
}

function attributeGroup(attribute: ReviewableAttribute): 'metric' | 'rule' {
  const explicit = attribute.group?.toLowerCase();
  if (explicit === 'rule') return 'rule';
  if (attribute.key.startsWith('rule:')) return 'rule';
  return 'metric';
}

function getPrimaryContext(item: ReviewableItem): { label: string; text: string } | null {
  const preferredLabels = ['First user query', 'Original text', 'Transcript', 'AI judge text', 'API value', 'Judge value'];
  for (const label of preferredLabels) {
    const match = item.evidence.find((entry) => entry.label === label && typeof entry.value === 'string' && entry.value.trim());
    if (match && typeof match.value === 'string') {
      return { label: match.label, text: match.value };
    }
  }
  const firstText = item.evidence.find((entry) => typeof entry.value === 'string' && entry.value.trim());
  if (firstText && typeof firstText.value === 'string') {
    return { label: firstText.label, text: firstText.value };
  }
  if (item.subtitle) {
    return { label: 'Context', text: item.subtitle };
  }
  return null;
}

function metricCategory(attribute: ReviewableAttribute): LabelCategory | undefined {
  if (attribute.key.includes('efficiency')) {
    return 'efficiency';
  }
  return undefined;
}

function renderRuleBadge(value: string) {
  const meta = getRuleOutcomeMeta(value.replace(/ /g, '_').toUpperCase() as Parameters<typeof getRuleOutcomeMeta>[0]);
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', meta.badgeClass)}>
      {meta.label}
    </span>
  );
}

function renderSimpleBadge(label: string, className: string) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', className)}>
      {label}
    </span>
  );
}

function renderAttributeBadge(value: string | null | undefined, attribute: ReviewableAttribute) {
  if (!value) {
    return <span className="text-xs text-[var(--text-muted)]">—</span>;
  }

  const normalized = value.replace(/_/g, ' ').toUpperCase().trim();
  if (attributeGroup(attribute) === 'rule') {
    return renderRuleBadge(normalized);
  }
  if (normalized === 'FAIL') {
    return renderSimpleBadge('Fail', 'border-[var(--color-error)]/30 bg-[color-mix(in_srgb,var(--color-error)_12%,transparent)] text-[var(--color-error)]');
  }
  if (normalized === 'PASS') {
    return renderSimpleBadge('Pass', 'border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)]');
  }

  return <VerdictBadge verdict={value} category={metricCategory(attribute)} showTooltip={false} size="sm" />;
}

export function RunReviewsTab({ appId, runId }: RunReviewsTabProps) {
  const appConfig = useAppConfig(appId);
  const [context, setContext] = useState<RunReviewContext | null>(null);
  const [selectedReview, setSelectedReview] = useState<EvalReviewDetail | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [activeItemKey, setActiveItemKey] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [edits, setEdits] = useState<Record<string, ReviewEditState>>({});
  const [threadSearch, setThreadSearch] = useState('');
  const [threadPage, setThreadPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [startingDraft, setStartingDraft] = useState(false);

  const loadSelectedReview = useCallback(async (reviewId: string | null) => {
    if (!reviewId) {
      setSelectedReview(null);
      setSelectedReviewId(null);
      setNotes('');
      setEdits({});
      return;
    }

    const detail = await fetchReviewDetail(reviewId);
    setSelectedReview(detail);
    setSelectedReviewId(detail.id);
    setNotes(detail.notes ?? '');
    setEdits(buildEditMap(detail));
  }, []);

  const refreshContext = useCallback(async (preferredReviewId?: string | null) => {
    const nextContext = await fetchRunReviewContext(runId);
    setContext(nextContext);
    const initialItemKey = nextContext.items[0]?.itemKey ?? null;
    setActiveItemKey((current) => current ?? initialItemKey);
    const nextReviewId = preferredReviewId ?? nextContext.draftReviewId ?? nextContext.latestReviewId ?? null;
    await loadSelectedReview(nextReviewId);
  }, [loadSelectedReview, runId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refreshContext()
      .catch((error: unknown) => {
        if (!cancelled) {
          notificationService.error(error instanceof Error ? error.message : 'Failed to load reviews');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshContext]);

  const allItems = useMemo(() => context?.items ?? [], [context?.items]);
  const filteredItems = useMemo(() => {
    const query = threadSearch.trim().toLowerCase();
    if (!query) return allItems;
    return allItems.filter((item) => (
      item.title.toLowerCase().includes(query)
      || item.itemKey.toLowerCase().includes(query)
      || item.subtitle?.toLowerCase().includes(query)
    ));
  }, [allItems, threadSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / THREAD_PAGE_SIZE));
  const pageItems = useMemo(() => {
    const start = (threadPage - 1) * THREAD_PAGE_SIZE;
    return filteredItems.slice(start, start + THREAD_PAGE_SIZE);
  }, [filteredItems, threadPage]);

  useEffect(() => {
    setThreadPage(1);
  }, [threadSearch]);

  useEffect(() => {
    if (!filteredItems.length) {
      setActiveItemKey(null);
      return;
    }
    if (!activeItemKey || !filteredItems.some((item) => item.itemKey === activeItemKey)) {
      setActiveItemKey(filteredItems[0].itemKey);
    }
  }, [activeItemKey, filteredItems]);

  useEffect(() => {
    if (threadPage > totalPages) {
      setThreadPage(totalPages);
    }
  }, [threadPage, totalPages]);

  const selectedItem = useMemo(
    () => allItems.find((item) => item.itemKey === activeItemKey) ?? filteredItems[0] ?? null,
    [activeItemKey, allItems, filteredItems],
  );

  const selectedItemSummary = useMemo(
    () => (selectedItem ? summarizeItem(selectedItem, edits) : 'Unreviewed'),
    [edits, selectedItem],
  );

  const selectedItemContext = useMemo(
    () => (selectedItem ? getPrimaryContext(selectedItem) : null),
    [selectedItem],
  );

  const groupedAttributes = useMemo(() => {
    if (!selectedItem) {
      return {
        metrics: [] as ReviewableAttribute[],
        rules: [] as ReviewableAttribute[],
      };
    }

    return selectedItem.attributes.reduce(
      (acc, attribute) => {
        if (attributeGroup(attribute) === 'rule') {
          acc.rules.push(attribute);
        } else {
          acc.metrics.push(attribute);
        }
        return acc;
      },
      { metrics: [] as ReviewableAttribute[], rules: [] as ReviewableAttribute[] },
    );
  }, [selectedItem]);

  const reviewIsDraft = selectedReview?.status === 'draft';
  const latestSummary = useMemo(
    () => context?.history.find((entry) => entry.id === context.latestReviewId) ?? null,
    [context],
  );

  const handleStartDraft = useCallback(async () => {
    try {
      setStartingDraft(true);
      const draft = await createRunReviewDraft(runId);
      await refreshContext(draft.id);
      notificationService.success('Draft review ready');
    } catch (error: unknown) {
      notificationService.error(error instanceof Error ? error.message : 'Failed to start draft');
    } finally {
      setStartingDraft(false);
    }
  }, [refreshContext, runId]);

  const handleSelectHistory = useCallback(async (reviewId: string) => {
    try {
      await loadSelectedReview(reviewId);
    } catch (error: unknown) {
      notificationService.error(error instanceof Error ? error.message : 'Failed to open review');
    }
  }, [loadSelectedReview]);

  const handlePageChange = useCallback((nextPage: number) => {
    setThreadPage(nextPage);
    const nextItem = filteredItems[(nextPage - 1) * THREAD_PAGE_SIZE];
    if (nextItem) {
      setActiveItemKey(nextItem.itemKey);
    }
  }, [filteredItems]);

  const updateAttribute = useCallback((item: ReviewableItem, attribute: ReviewableAttribute, patch: Partial<ReviewEditState>) => {
    const key = reviewKey(item.itemKey, attribute.key);
    setEdits((current) => ({
      ...current,
      [key]: {
        ...current[key],
        itemKey: item.itemKey,
        itemType: item.itemType,
        attributeKey: attribute.key,
        decision: '',
        originalValue: attribute.originalValue,
        reviewedValue: null,
        reasonCode: null,
        note: null,
        ...patch,
      },
    }));
  }, []);

  const handleSave = useCallback(async (mode: 'draft' | 'final') => {
    if (!selectedReview || !reviewIsDraft) return;
    try {
      setSaving(true);
      const payload = toPayload(notes, edits);
      const nextReview = mode === 'final'
        ? await finalizeReview(selectedReview.id, payload)
        : await saveReviewDraft(selectedReview.id, payload);
      await refreshContext(nextReview.id);
      notificationService.success(mode === 'final' ? 'Review finalized' : 'Draft saved');
    } catch (error: unknown) {
      notificationService.error(error instanceof Error ? error.message : 'Failed to save review');
    } finally {
      setSaving(false);
    }
  }, [edits, notes, refreshContext, reviewIsDraft, selectedReview]);

  const handleDiscardDraft = useCallback(async () => {
    if (!selectedReview || !reviewIsDraft) return;
    try {
      setSaving(true);
      await discardReviewDraft(selectedReview.id);
      await refreshContext(context?.latestReviewId ?? null);
      notificationService.success('Draft discarded');
    } catch (error: unknown) {
      notificationService.error(error instanceof Error ? error.message : 'Failed to discard draft');
    } finally {
      setSaving(false);
    }
  }, [context?.latestReviewId, refreshContext, reviewIsDraft, selectedReview]);

  if (!appConfig.reviews.enabled) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-8 text-sm text-[var(--text-secondary)]">
        Reviews are disabled for this app.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-8 text-sm text-[var(--text-secondary)]">
        Loading reviews...
      </div>
    );
  }

  if (!context) {
    return (
      <div className="rounded-lg border border-[var(--border-error)] bg-[var(--surface-error)] px-4 py-8 text-sm text-[var(--color-error)]">
        Review context could not be loaded.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                <FilePenLine className="h-4 w-4 text-[var(--text-brand)]" />
                Review canvas
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                Review thread-level metrics and rule outcomes in one compact workspace.
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {latestSummary ? (
                  <>
                    <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1 text-[var(--text-primary)]">
                      Latest final: {latestSummary.overallDecision ?? 'No overall decision'}
                    </span>
                    <span className="text-[var(--text-secondary)]">
                      {formatTimestamp(latestSummary.completedAt ?? latestSummary.updatedAt)}
                    </span>
                  </>
                ) : (
                  <span className="text-[var(--text-muted)]">No final human review yet.</span>
                )}
                {context.history.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] px-2 py-1 text-[var(--text-secondary)]">
                    <History className="h-3 w-3" />
                    {context.history.length}
                  </span>
                )}
                {context.history.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => handleSelectHistory(entry.id)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-left transition-colors',
                      selectedReviewId === entry.id
                        ? 'border-[var(--border-brand)] bg-[var(--surface-brand-subtle)] text-[var(--text-brand)]'
                        : 'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)]',
                    )}
                  >
                    {entry.status === 'draft' ? 'Draft' : 'Final'} · {formatTimestamp(entry.completedAt ?? entry.updatedAt)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1 self-start">
              {!reviewIsDraft && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={PencilLine}
                  iconOnly
                  onClick={handleStartDraft}
                  isLoading={startingDraft}
                  aria-label={context.draftReviewId ? 'Open draft' : 'Start draft'}
                  title={context.draftReviewId ? 'Open draft' : 'Start draft'}
                />
              )}
              {reviewIsDraft && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Trash2}
                    iconOnly
                    onClick={handleDiscardDraft}
                    disabled={saving}
                    aria-label="Discard draft"
                    title="Discard draft"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Save}
                    iconOnly
                    onClick={() => handleSave('draft')}
                    isLoading={saving}
                    aria-label="Save draft"
                    title="Save draft"
                  />
                  <Button
                    size="sm"
                    icon={SendHorizontal}
                    iconOnly
                    onClick={() => handleSave('final')}
                    isLoading={saving}
                    aria-label="Finalize review"
                    title="Finalize review"
                  />
                </>
              )}
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="grid gap-4 lg:h-[min(78vh,960px)] lg:grid-cols-[240px_minmax(0,1fr)]">
            <div className="min-h-0 lg:sticky lg:top-0 lg:self-start lg:h-full">
              <div className="flex h-full min-h-0 flex-col rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2">
                <div className="px-2 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  Threads ({filteredItems.length})
                </div>
                <Input
                  value={threadSearch}
                  onChange={(event) => setThreadSearch(event.target.value)}
                  placeholder="Search thread ID"
                  icon={<Search className="h-3.5 w-3.5" />}
                  className="mb-2 h-8 text-[13px]"
                />
                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                  {pageItems.map((item) => (
                    <button
                      key={item.itemKey}
                      type="button"
                      onClick={() => setActiveItemKey(item.itemKey)}
                      className={cn(
                        'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                        selectedItem?.itemKey === item.itemKey
                          ? 'border-[var(--border-brand)] bg-[var(--surface-brand-subtle)]'
                          : 'border-[var(--border-default)] bg-[var(--bg-primary)] hover:bg-[var(--interactive-secondary)]',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-[var(--text-primary)]">{item.title}</span>
                        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', summarizeTone(summarizeItem(item, edits)))} />
                      </div>
                    </button>
                  ))}
                  {pageItems.length === 0 && (
                    <div className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-4 text-center text-xs text-[var(--text-muted)]">
                      No threads match this search.
                    </div>
                  )}
                </div>
                <div className="border-t border-[var(--border-subtle)] px-2 pt-2">
                  <Pagination
                    page={threadPage}
                    totalPages={totalPages}
                    onPageChange={handlePageChange}
                    showCount
                    totalItems={filteredItems.length}
                    pageSize={THREAD_PAGE_SIZE}
                  />
                </div>
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto pr-1">
              <div className="space-y-4">
                {!selectedItem ? (
                  <div className="rounded-lg border border-dashed border-[var(--border-default)] px-4 py-8 text-sm text-[var(--text-muted)]">
                    No reviewable items were found for this run.
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                            Thread
                          </div>
                          <div className="break-all text-lg font-semibold leading-7 text-[var(--text-primary)]">
                            {selectedItem.title}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', summaryBadgeClass(selectedItemSummary))}>
                            {selectedItemSummary}
                          </span>
                          {selectedReview?.status === 'final' && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-success)]" />
                              Final
                            </span>
                          )}
                          {selectedReview?.status === 'draft' && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                              <XCircle className="h-3.5 w-3.5 text-[var(--color-warning)]" />
                              Draft
                            </span>
                          )}
                        </div>
                      </div>

                      {selectedItemContext && (
                        <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-3">
                          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                            {selectedItemContext.label}
                          </div>
                          <div className="mt-1 text-sm leading-6 text-[var(--text-primary)]">
                            {selectedItemContext.text}
                          </div>
                        </div>
                      )}
                    </div>

                    {groupedAttributes.metrics.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-[var(--text-primary)]">Metrics</div>
                            <div className="text-xs text-[var(--text-secondary)]">
                              Overall and evaluator-level labels render from the review payload instead of hardcoded metric names.
                            </div>
                          </div>
                          <span className="rounded-full border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                            {groupedAttributes.metrics.length} fields
                          </span>
                        </div>

                        <div className="grid gap-3 xl:grid-cols-2">
                          {groupedAttributes.metrics.map((attribute) => {
                            const key = reviewKey(selectedItem.itemKey, attribute.key);
                            const state = edits[key];
                            const readOnlyRecord = selectedReview?.items.find(
                              (item) => item.itemKey === selectedItem.itemKey && item.attributeKey === attribute.key,
                            );
                            const activeState = state ?? {
                              itemKey: selectedItem.itemKey,
                              itemType: selectedItem.itemType,
                              attributeKey: attribute.key,
                              decision: '',
                              originalValue: attribute.originalValue,
                              reviewedValue: null,
                              reasonCode: null,
                              note: null,
                            };

                            return (
                              <div key={key} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-medium text-[var(--text-primary)]">{attribute.label}</div>
                                    {(attribute.sourceLabel || attribute.description) && (
                                      <div className="mt-1 text-xs text-[var(--text-secondary)]">
                                        {[attribute.sourceLabel, attribute.description].filter(Boolean).join(' · ')}
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-right">
                                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">AI label</div>
                                    <div className="mt-1 flex justify-end">
                                      {renderAttributeBadge(attribute.originalValue, attribute)}
                                    </div>
                                  </div>
                                </div>

                                <div className="mt-4 space-y-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className={cn('text-xs font-medium', decisionTone(state?.decision ?? readOnlyRecord?.decision))}>
                                      {decisionLabel(state ?? readOnlyRecord)}
                                    </span>
                                    {(activeState.reviewedValue || readOnlyRecord?.reviewedValue) && (
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Override</span>
                                        {renderAttributeBadge(activeState.reviewedValue ?? readOnlyRecord?.reviewedValue, attribute)}
                                      </div>
                                    )}
                                  </div>

                                  <div className="grid gap-3 lg:grid-cols-2">
                                    <Select
                                      value={activeState.decision || UNSET_DECISION_VALUE}
                                      onChange={(value) => updateAttribute(selectedItem, attribute, {
                                        decision: value === UNSET_DECISION_VALUE ? '' : value as ReviewEditState['decision'],
                                        reviewedValue: value === 'correct' ? activeState.reviewedValue ?? attribute.allowedValues[0] ?? null : null,
                                      })}
                                      options={DECISION_OPTIONS}
                                      disabled={!reviewIsDraft}
                                      size="sm"
                                    />

                                    {activeState.decision === 'correct' && (
                                      <Select
                                        value={activeState.reviewedValue ?? ''}
                                        onChange={(value) => updateAttribute(selectedItem, attribute, { reviewedValue: value || null })}
                                        options={attribute.allowedValues.map((value) => ({ value, label: formatValueLabel(value) }))}
                                        disabled={!reviewIsDraft}
                                        size="sm"
                                      />
                                    )}
                                  </div>

                                  <Select
                                    value={activeState.reasonCode ?? UNSET_REASON_VALUE}
                                    onChange={(value) => updateAttribute(selectedItem, attribute, {
                                      reasonCode: value === UNSET_REASON_VALUE ? null : value,
                                    })}
                                    options={REASON_OPTIONS}
                                    disabled={!reviewIsDraft}
                                    size="sm"
                                  />

                                  <textarea
                                    value={activeState.note ?? ''}
                                    onChange={(event) => updateAttribute(selectedItem, attribute, { note: event.target.value || null })}
                                    disabled={!reviewIsDraft}
                                    placeholder="Optional reviewer note"
                                    className={cn(
                                      'min-h-[72px] w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]',
                                      'placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]',
                                      !reviewIsDraft && 'cursor-not-allowed opacity-70',
                                    )}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {groupedAttributes.rules.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-[var(--text-primary)]">Rules</div>
                            <div className="text-xs text-[var(--text-secondary)]">
                              Rule outcomes stay reviewable at the same thread level as the higher-order verdicts.
                            </div>
                          </div>
                          <span className="rounded-full border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                            {groupedAttributes.rules.length} rules
                          </span>
                        </div>

                        <div className="space-y-3">
                          {groupedAttributes.rules.map((attribute) => {
                            const key = reviewKey(selectedItem.itemKey, attribute.key);
                            const state = edits[key];
                            const readOnlyRecord = selectedReview?.items.find(
                              (item) => item.itemKey === selectedItem.itemKey && item.attributeKey === attribute.key,
                            );
                            const activeState = state ?? {
                              itemKey: selectedItem.itemKey,
                              itemType: selectedItem.itemType,
                              attributeKey: attribute.key,
                              decision: '',
                              originalValue: attribute.originalValue,
                              reviewedValue: null,
                              reasonCode: null,
                              note: null,
                            };

                            return (
                              <div key={key} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                  <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <div className="text-sm font-medium text-[var(--text-primary)]">{attribute.label}</div>
                                      {renderAttributeBadge(attribute.originalValue, attribute)}
                                    </div>
                                    {(attribute.sourceLabel || attribute.description) && (
                                      <div className="text-xs text-[var(--text-secondary)]">
                                        {[attribute.sourceLabel, attribute.description].filter(Boolean).join(' · ')}
                                      </div>
                                    )}
                                    {attribute.evidence && (
                                      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]">
                                        {attribute.evidence}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className={cn('text-xs font-medium', decisionTone(state?.decision ?? readOnlyRecord?.decision))}>
                                      {decisionLabel(state ?? readOnlyRecord)}
                                    </span>
                                    {(activeState.reviewedValue || readOnlyRecord?.reviewedValue) && (
                                      renderAttributeBadge(activeState.reviewedValue ?? readOnlyRecord?.reviewedValue, attribute)
                                    )}
                                  </div>
                                </div>

                                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                                  <Select
                                    value={activeState.decision || UNSET_DECISION_VALUE}
                                    onChange={(value) => updateAttribute(selectedItem, attribute, {
                                      decision: value === UNSET_DECISION_VALUE ? '' : value as ReviewEditState['decision'],
                                      reviewedValue: value === 'correct' ? activeState.reviewedValue ?? attribute.allowedValues[0] ?? null : null,
                                    })}
                                    options={DECISION_OPTIONS}
                                    disabled={!reviewIsDraft}
                                    size="sm"
                                  />

                                  {activeState.decision === 'correct' && (
                                    <Select
                                      value={activeState.reviewedValue ?? ''}
                                      onChange={(value) => updateAttribute(selectedItem, attribute, { reviewedValue: value || null })}
                                      options={attribute.allowedValues.map((value) => ({ value, label: formatValueLabel(value) }))}
                                      disabled={!reviewIsDraft}
                                      size="sm"
                                    />
                                  )}

                                  <Select
                                    value={activeState.reasonCode ?? UNSET_REASON_VALUE}
                                    onChange={(value) => updateAttribute(selectedItem, attribute, {
                                      reasonCode: value === UNSET_REASON_VALUE ? null : value,
                                    })}
                                    options={REASON_OPTIONS}
                                    disabled={!reviewIsDraft}
                                    size="sm"
                                  />
                                </div>

                                <div className="mt-3">
                                  <textarea
                                    value={activeState.note ?? ''}
                                    onChange={(event) => updateAttribute(selectedItem, attribute, { note: event.target.value || null })}
                                    disabled={!reviewIsDraft}
                                    placeholder="Optional reviewer note"
                                    className={cn(
                                      'min-h-[64px] w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]',
                                      'placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]',
                                      !reviewIsDraft && 'cursor-not-allowed opacity-70',
                                    )}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                      <div className="mb-3">
                        <div className="text-sm font-semibold text-[var(--text-primary)]">Review summary</div>
                        <div className="text-xs text-[var(--text-secondary)]">
                          Capture the cross-cutting note once while item-level notes stay on each override.
                        </div>
                      </div>
                      <textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        disabled={!reviewIsDraft}
                        placeholder="Summarize what the reviewer changed or what the AI missed."
                        className={cn(
                          'min-h-[112px] w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]',
                          'placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]',
                          !reviewIsDraft && 'cursor-not-allowed opacity-70',
                        )}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
