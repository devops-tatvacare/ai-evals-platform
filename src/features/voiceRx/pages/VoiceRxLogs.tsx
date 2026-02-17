import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScrollText, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { fetchVoiceRxRuns, fetchVoiceRxRunById } from '@/services/api/voiceRxHistoryApi';
import { useListingsStore } from '@/stores';
import { TAG_ACCENT_COLORS } from '@/utils/statusColors';
import { timeAgo, formatDuration, formatTimestamp } from '@/utils/evalFormatters';
import type { EvaluatorRunHistory, HistoryScores } from '@/types';

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function scoreColor(scores: HistoryScores | null): string {
  if (!scores || scores.overall_score == null) return 'var(--text-muted)';
  const val = typeof scores.overall_score === 'number'
    ? scores.overall_score
    : typeof scores.overall_score === 'string'
      ? parseFloat(scores.overall_score)
      : NaN;
  if (isNaN(val)) return 'var(--text-muted)';

  const meta = scores.metadata as Record<string, unknown> | null;
  const thresholds = meta?.thresholds as { pass?: number; warn?: number } | undefined;
  const pass = thresholds?.pass ?? 0.7;
  const warn = thresholds?.warn ?? 0.4;

  if (val >= pass) return 'var(--color-success)';
  if (val >= warn) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function formatScore(scores: HistoryScores | null): string {
  if (!scores || scores.overall_score == null) return '--';
  if (typeof scores.overall_score === 'boolean') return scores.overall_score ? 'Pass' : 'Fail';
  if (typeof scores.overall_score === 'number') {
    return scores.overall_score <= 1
      ? `${(scores.overall_score * 100).toFixed(0)}%`
      : String(scores.overall_score);
  }
  return String(scores.overall_score);
}

function formatJson(value: unknown): string {
  if (value == null) return '--';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

interface RunGroup {
  sourceId: string;
  evaluatorName: string;
  runs: EvaluatorRunHistory[];
  errorCount: number;
}

export function VoiceRxLogs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const entityIdFilter = searchParams.get('entity_id') || '';
  const sourceIdFilter = searchParams.get('source_id') || '';
  const [runs, setRuns] = useState<EvaluatorRunHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const voiceRxListings = useListingsStore((s) => s.listings['voice-rx']);

  useEffect(() => {
    setLoading(true);

    if (entityIdFilter) {
      // Single run by ID
      fetchVoiceRxRunById(entityIdFilter)
        .then((run) => {
          setRuns(run ? [run] : []);
          if (run) setExpandedId(run.id);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      fetchVoiceRxRuns(200)
        .then(setRuns)
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [entityIdFilter]);

  const filteredRuns = useMemo(() => {
    let result = runs;

    if (sourceIdFilter) {
      result = result.filter((r) => r.sourceId === sourceIdFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.data.evaluator_name.toLowerCase().includes(q) ||
          (r.entityId && r.entityId.toLowerCase().includes(q)) ||
          r.id.toLowerCase().includes(q),
      );
    }

    return result;
  }, [runs, sourceIdFilter, searchQuery]);

  const runGroups = useMemo((): RunGroup[] => {
    const map = new Map<string, EvaluatorRunHistory[]>();
    for (const run of filteredRuns) {
      const key = run.sourceId || run.data.evaluator_name || '(unknown)';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(run);
    }

    const groups: RunGroup[] = [];
    for (const [sourceId, groupRuns] of map) {
      groups.push({
        sourceId,
        evaluatorName: groupRuns[0].data.evaluator_name,
        runs: groupRuns,
        errorCount: groupRuns.filter((r) => r.status !== 'success').length,
      });
    }
    return groups;
  }, [filteredRuns]);

  const showGrouped = !entityIdFilter && runGroups.length > 1;
  const listingMap = useMemo(
    () => new Map(voiceRxListings.map((l) => [l.id, l.title])),
    [voiceRxListings],
  );

  const handleClearFilter = () => {
    setSearchParams({});
  };

  const toggleGroupCollapse = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const collapseAll = () => setCollapsedGroups(new Set(runGroups.map((g) => g.sourceId)));
  const expandAll = () => setCollapsedGroups(new Set());

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-[0.8rem] text-[var(--color-error)]">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4 flex-1 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold text-[var(--text-primary)]">Evaluator Logs</h1>
          <span className="text-[var(--text-xs)] text-[var(--text-muted)]">
            {filteredRuns.length}{searchQuery ? `/${runs.length}` : ''} entries
            {showGrouped && ` across ${runGroups.length} evaluators`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {showGrouped && (
            <div className="flex items-center gap-1">
              <button
                onClick={expandAll}
                className="px-2 py-1 text-[var(--text-xs)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
              >
                Expand all
              </button>
              <span className="text-[var(--text-muted)]">/</span>
              <button
                onClick={collapseAll}
                className="px-2 py-1 text-[var(--text-xs)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
              >
                Collapse all
              </button>
            </div>
          )}
          {(entityIdFilter || sourceIdFilter) && (
            <button
              onClick={handleClearFilter}
              className="px-2.5 py-1 text-[var(--text-xs)] font-medium text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded hover:bg-[var(--bg-secondary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
            >
              Clear filter
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      {!loading && runs.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by evaluator name or ID..."
            className="w-full pl-9 pr-8 py-2 text-[13px] rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)] focus:border-transparent transition-shadow"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex-1 min-h-full flex items-center justify-center text-[0.8rem] text-[var(--text-muted)]">Loading...</div>
      ) : runs.length === 0 ? (
        <div className="flex-1 min-h-full flex items-center justify-center">
          <EmptyState
            icon={ScrollText}
            title="No evaluator logs found"
            description="Run an evaluator on a recording to generate logs."
          />
        </div>
      ) : filteredRuns.length === 0 && searchQuery ? (
        <div className="flex-1 min-h-full flex items-center justify-center">
          <EmptyState
            icon={Search}
            title="No matching logs"
            description={`No logs match "${searchQuery}".`}
          />
        </div>
      ) : showGrouped ? (
        <div className="space-y-3">
          {runGroups.map((group) => (
            <EvaluatorGroupCard
              key={group.sourceId}
              group={group}
              collapsed={collapsedGroups.has(group.sourceId)}
              onToggleCollapse={() => toggleGroupCollapse(group.sourceId)}
              expandedLogId={expandedId}
              onToggleLog={(id) => setExpandedId(expandedId === id ? null : id)}
              listingMap={listingMap}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {filteredRuns.map((run) => (
            <LogRow
              key={run.id}
              run={run}
              expanded={expandedId === run.id}
              onToggle={() => setExpandedId(expandedId === run.id ? null : run.id)}
              listingMap={listingMap}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Evaluator Group Card ──────────────────────────────────────── */

function EvaluatorGroupCard({
  group,
  collapsed,
  onToggleCollapse,
  expandedLogId,
  onToggleLog,
  listingMap,
}: {
  group: RunGroup;
  collapsed: boolean;
  onToggleCollapse: () => void;
  expandedLogId: string | null;
  onToggleLog: (id: string) => void;
  listingMap: Map<string, string>;
}) {
  const color = TAG_ACCENT_COLORS[hashString(group.evaluatorName) % TAG_ACCENT_COLORS.length];

  return (
    <div className="rounded-lg border border-[var(--border-default)] overflow-hidden">
      <button
        onClick={onToggleCollapse}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-[var(--bg-secondary)]/60 hover:bg-[var(--bg-secondary)] transition-colors text-left"
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
        )}

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-[var(--text-xs)] font-semibold"
            style={{
              backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
              color,
            }}
          >
            {group.evaluatorName}
          </span>

          <div className="flex items-center gap-2 text-[var(--text-xs)] text-[var(--text-muted)]">
            <span>{group.runs.length} run{group.runs.length !== 1 ? 's' : ''}</span>
            {group.errorCount > 0 && (
              <>
                <span className="text-[var(--text-tertiary)]">&middot;</span>
                <span className="text-[var(--color-error)] font-medium">
                  {group.errorCount} error{group.errorCount !== 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
        </div>
      </button>

      {!collapsed && (
        <div className="border-t border-[var(--border-subtle)]">
          <div className="space-y-px">
            {group.runs.map((run) => (
              <LogRow
                key={run.id}
                run={run}
                expanded={expandedLogId === run.id}
                onToggle={() => onToggleLog(run.id)}
                listingMap={listingMap}
                nested
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Individual Log Row ────────────────────────────────────────── */

function LogRow({
  run,
  expanded,
  onToggle,
  listingMap,
  nested = false,
}: {
  run: EvaluatorRunHistory;
  expanded: boolean;
  onToggle: () => void;
  listingMap: Map<string, string>;
  nested?: boolean;
}) {
  const hasError = run.status !== 'success';
  const borderColor = hasError ? 'border-l-[var(--color-error)]' : 'border-l-[var(--color-success)]';
  const color = TAG_ACCENT_COLORS[hashString(run.data.evaluator_name) % TAG_ACCENT_COLORS.length];
  const outerClass = nested
    ? `border-l-[3px] ${borderColor}`
    : `bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md overflow-hidden border-l-[3px] ${borderColor}`;

  return (
    <div className={outerClass}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--bg-secondary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="shrink-0 inline-flex items-center px-1.5 py-px rounded text-[0.65rem] font-medium"
            style={{
              backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
              color,
            }}
          >
            {run.data.evaluator_name}
          </span>
          <span
            className="text-[13px] font-semibold shrink-0"
            style={{ color: scoreColor(run.data.scores) }}
          >
            {formatScore(run.data.scores)}
          </span>
          {run.entityId && (
            <span className="text-[var(--text-xs)] text-[var(--text-muted)] truncate">
              {listingMap.get(run.entityId) || run.entityId.slice(0, 8)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[var(--text-xs)] text-[var(--text-muted)]">
            {run.durationMs ? formatDuration(run.durationMs / 1000) : ''}
          </span>
          <span className="text-[var(--text-xs)] text-[var(--text-muted)]">
            {run.timestamp ? timeAgo(new Date(run.timestamp).toISOString()) : ''}
          </span>
          <span className="text-[var(--text-xs)] text-[var(--text-tertiary)]">
            {expanded ? '\u25B2' : '\u25BC'}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border-subtle)] px-3 py-3 space-y-3">
          {/* Metadata grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[var(--text-xs)]">
            <div>
              <span className="text-[var(--text-muted)]">ID</span>
              <p className="font-mono font-medium text-[var(--text-primary)]">{run.id.slice(0, 12)}</p>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Evaluator Type</span>
              <p className="font-medium text-[var(--text-primary)]">{run.data.evaluator_type}</p>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Duration</span>
              <p className="font-medium text-[var(--text-primary)]">
                {run.durationMs ? formatDuration(run.durationMs / 1000) : '--'}
              </p>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Timestamp</span>
              <p className="font-medium text-[var(--text-primary)]">
                {run.timestamp ? formatTimestamp(new Date(run.timestamp).toISOString()) : '--'}
              </p>
            </div>
          </div>

          {/* Scores */}
          {run.data.scores && (
            <div>
              <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1">
                Scores
              </p>
              <pre className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded p-2.5 text-[var(--text-xs)] text-[var(--text-primary)] whitespace-pre-wrap max-h-48 overflow-y-auto">
                {formatJson(run.data.scores)}
              </pre>
            </div>
          )}

          {/* Input payload */}
          {run.data.input_payload && (
            <div>
              <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1">
                Input Payload
              </p>
              <pre className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded p-2.5 text-[var(--text-xs)] text-[var(--text-primary)] whitespace-pre-wrap max-h-64 overflow-y-auto">
                {formatJson(run.data.input_payload)}
              </pre>
            </div>
          )}

          {/* Output payload */}
          {run.data.output_payload && (
            <div>
              <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--color-success)] font-semibold mb-1">
                Output Payload
              </p>
              <pre className="bg-[var(--surface-success)] border border-[var(--border-success)] rounded p-2.5 text-[var(--text-xs)] text-[var(--text-primary)] whitespace-pre-wrap max-h-64 overflow-y-auto">
                {formatJson(run.data.output_payload)}
              </pre>
            </div>
          )}

          {/* Error details */}
          {run.data.error_details && (
            <div>
              <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--color-error)] font-semibold mb-1">
                Error Details
              </p>
              <pre className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-2.5 text-[var(--text-xs)] text-[var(--color-error)] whitespace-pre-wrap">
                {formatJson(run.data.error_details)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
