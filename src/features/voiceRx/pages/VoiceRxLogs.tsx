import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Badge, ModelBadge } from '@/components/ui';
import { fetchEvalRuns, fetchEvalRun } from '@/services/api/evalRunsApi';
import { useListingsStore } from '@/stores';
import { TAG_ACCENT_COLORS } from '@/utils/statusColors';
import { timeAgo, formatDuration, formatTimestamp } from '@/utils/evalFormatters';
import { routes } from '@/config/routes';
import type { EvalRun } from '@/types';
import {
  LogsPageShell,
  LogGroupCard,
  LogRowShell,
  CopyableCodeBlock,
} from '@/features/evalRuns/components/logs';

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getRunName(run: EvalRun): string {
  const s = run.summary as Record<string, unknown> | undefined;
  const c = run.config as Record<string, unknown> | undefined;
  return (s?.evaluator_name as string) ?? (c?.evaluator_name as string) ?? run.evalType ?? 'Unknown';
}

function getRunScore(run: EvalRun): { value: string; color: string } {
  const s = run.summary as Record<string, unknown> | undefined;
  if (!s) return { value: '--', color: 'var(--text-muted)' };
  for (const [, v] of Object.entries(s)) {
    if (typeof v === 'number' && v >= 0 && v <= 1) {
      const pct = `${(v * 100).toFixed(0)}%`;
      const color = v >= 0.7 ? 'var(--color-success)' : v >= 0.4 ? 'var(--color-warning)' : 'var(--color-error)';
      return { value: pct, color };
    }
  }
  return { value: '--', color: 'var(--text-muted)' };
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

const STATUS_DOT_MAP: Record<string, 'success' | 'error' | 'warning' | 'info' | 'neutral'> = {
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
  completed_with_errors: 'warning',
  running: 'info',
  pending: 'neutral',
};

interface RunGroup {
  sourceId: string;
  evaluatorName: string;
  runs: EvalRun[];
  errorCount: number;
}

export function VoiceRxLogs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const entityIdFilter = searchParams.get('entity_id') || '';
  const sourceIdFilter = searchParams.get('source_id') || '';
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const voiceRxListings = useListingsStore((s) => s.listings['voice-rx']);

  useEffect(() => {
    setLoading(true);

    if (entityIdFilter) {
      fetchEvalRun(entityIdFilter)
        .then((run) => {
          setRuns(run ? [run] : []);
          if (run) setExpandedId(run.id);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      fetchEvalRuns({ app_id: 'voice-rx', limit: 200 })
        .then(setRuns)
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [entityIdFilter]);

  const filteredRuns = useMemo(() => {
    let result = runs;

    if (sourceIdFilter) {
      result = result.filter((r) => r.evaluatorId === sourceIdFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (r) =>
          getRunName(r).toLowerCase().includes(q) ||
          (r.listingId && r.listingId.toLowerCase().includes(q)) ||
          r.id.toLowerCase().includes(q),
      );
    }

    return result;
  }, [runs, sourceIdFilter, searchQuery]);

  const runGroups = useMemo((): RunGroup[] => {
    const map = new Map<string, EvalRun[]>();
    for (const run of filteredRuns) {
      const key = run.evaluatorId || getRunName(run) || '(unknown)';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(run);
    }

    const groups: RunGroup[] = [];
    for (const [sourceId, groupRuns] of map) {
      groups.push({
        sourceId,
        evaluatorName: getRunName(groupRuns[0]),
        runs: groupRuns,
        errorCount: groupRuns.filter((r) => r.status !== 'completed').length,
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
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-sm text-[var(--color-error)]">
        {error}
      </div>
    );
  }

  return (
    <LogsPageShell
      title="Evaluator Logs"
      totalCount={runs.length}
      filteredCount={filteredRuns.length}
      groupCount={showGrouped ? runGroups.length : undefined}
      isSearching={!!searchQuery.trim()}
      loading={loading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search by evaluator name or ID..."
      emptyTitle="No evaluator logs found"
      emptyDescription="Run an evaluator on a recording to generate logs."
      showExpandCollapseAll={showGrouped}
      onExpandAll={expandAll}
      onCollapseAll={collapseAll}
      headerActions={
        (entityIdFilter || sourceIdFilter) ? (
          <button
            onClick={handleClearFilter}
            className="px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded hover:bg-[var(--bg-secondary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
          >
            Clear filter
          </button>
        ) : undefined
      }
    >
      {showGrouped ? (
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
            <LogRowItem
              key={run.id}
              run={run}
              expanded={expandedId === run.id}
              onToggle={() => setExpandedId(expandedId === run.id ? null : run.id)}
              listingMap={listingMap}
            />
          ))}
        </div>
      )}
    </LogsPageShell>
  );
}

/* -- Evaluator Group Card ------------------------------------------------ */

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
  const primaryModel = group.runs.find((r) => r.llmModel)?.llmModel;

  return (
    <LogGroupCard
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      headerLeft={
        <>
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
            style={{
              backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
              color,
            }}
          >
            {group.evaluatorName}
          </span>

          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
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

          {primaryModel && (
            <ModelBadge modelName={primaryModel} variant="inline" className="ml-1" />
          )}
        </>
      }
      headerRight={
        <a
          href={`${routes.voiceRx.logs}?source_id=${group.sourceId}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          title="View only this evaluator's logs"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      }
    >
      {group.runs.map((run) => (
        <LogRowItem
          key={run.id}
          run={run}
          expanded={expandedLogId === run.id}
          onToggle={() => onToggleLog(run.id)}
          listingMap={listingMap}
          nested
        />
      ))}
    </LogGroupCard>
  );
}

/* -- Individual Log Row -------------------------------------------------- */

function LogRowItem({
  run,
  expanded,
  onToggle,
  listingMap,
  nested = false,
}: {
  run: EvalRun;
  expanded: boolean;
  onToggle: () => void;
  listingMap: Map<string, string>;
  nested?: boolean;
}) {
  const hasError = run.status !== 'completed';
  const runName = getRunName(run);
  const color = TAG_ACCENT_COLORS[hashString(runName) % TAG_ACCENT_COLORS.length];
  const score = getRunScore(run);
  const statusDot = STATUS_DOT_MAP[run.status] || 'neutral';

  return (
    <LogRowShell
      expanded={expanded}
      onToggle={onToggle}
      nested={nested}
      accentColor={hasError ? 'error' : 'success'}
      summaryLeft={
        <>
          <span
            className="shrink-0 inline-flex items-center px-1.5 py-px rounded text-[0.65rem] font-medium"
            style={{
              backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
              color,
            }}
          >
            {runName}
          </span>
          <Badge variant={statusDot === 'success' ? 'success' : statusDot === 'error' ? 'error' : 'warning'} dot={statusDot} size="sm">
            {run.status}
          </Badge>
          <span
            className="text-[13px] font-semibold shrink-0"
            style={{ color: score.color }}
          >
            {score.value}
          </span>
          {run.listingId && (
            <span className="text-xs text-[var(--text-muted)] truncate">
              {listingMap.get(run.listingId) || run.listingId.slice(0, 8)}
            </span>
          )}
        </>
      }
      summaryRight={
        <>
          {run.llmModel && (
            <ModelBadge modelName={run.llmModel} variant="inline" />
          )}
          <span className="text-xs text-[var(--text-muted)]">
            {run.durationMs ? formatDuration(run.durationMs / 1000) : ''}
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            {run.createdAt ? timeAgo(run.createdAt) : ''}
          </span>
        </>
      }
    >
      {/* Metadata grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div>
          <span className="text-[var(--text-muted)]">ID</span>
          <p className="font-mono font-medium text-[var(--text-primary)]">{run.id.slice(0, 12)}</p>
        </div>
        <div>
          <span className="text-[var(--text-muted)]">Evaluator Type</span>
          <p className="font-medium text-[var(--text-primary)]">{run.evalType}</p>
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
            {run.createdAt ? formatTimestamp(run.createdAt) : '--'}
          </p>
        </div>
      </div>

      {/* Scores (summary) */}
      {run.summary && (
        <CopyableCodeBlock
          content={formatJson(run.summary)}
          label="Scores"
          labelColor="var(--text-muted)"
          maxHeight="max-h-48"
        />
      )}

      {/* Input (config) */}
      {run.config && Object.keys(run.config).length > 0 && (
        <CopyableCodeBlock
          content={formatJson(run.config)}
          label="Input Payload"
          labelColor="var(--text-muted)"
        />
      )}

      {/* Output (result) */}
      {run.result && (
        <CopyableCodeBlock
          content={formatJson(run.result)}
          label="Output Payload"
          labelColor="var(--color-success)"
          variant="success"
        />
      )}

      {/* Error details */}
      {run.errorMessage && (
        <CopyableCodeBlock
          content={formatJson(run.errorMessage)}
          label="Error Details"
          labelColor="var(--color-error)"
          variant="error"
        />
      )}
    </LogRowShell>
  );
}
