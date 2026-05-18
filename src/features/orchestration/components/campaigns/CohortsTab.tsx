import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { useCurrentAppId } from '@/hooks';
import { useCohorts } from '@/features/orchestration/queries/cohorts';
import type { CohortResponse } from '@/services/api/orchestrationCohorts';
import { timeAgo } from '@/utils/evalFormatters';
import { CohortDetailPane } from '../cohorts/CohortDetailPane';
import { CreateCohortDialog } from '../cohorts/CreateCohortDialog';

interface CohortsTabProps {
  showCreate?: boolean;
  onShowCreateChange?: (next: boolean) => void;
  highlightId?: string | null;
}

export function CohortsTab({
  showCreate: showCreateProp,
  onShowCreateChange,
  highlightId,
}: CohortsTabProps = {}) {
  const appId = useCurrentAppId();
  const { data: rows = [], isLoading } = useCohorts(appId);

  const [showCreateLocal, setShowCreateLocal] = useState(false);
  const showCreate = showCreateProp ?? showCreateLocal;
  const setShowCreate = (next: boolean) => {
    if (showCreateProp === undefined) setShowCreateLocal(next);
    onShowCreateChange?.(next);
  };

  const [selectedId, setSelectedId] = useState<string | null>(highlightId ?? null);

  const columns: ColumnDef<CohortResponse>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (c) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--text-primary)]">{c.name}</span>
          {c.description ? (
            <span className="line-clamp-1 text-[11px] text-[var(--text-secondary)]">
              {c.description}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      render: (c) => (
        <span className="font-mono text-[var(--text-secondary)]">
          {c.latestVersion?.sourceRef ?? '—'}
        </span>
      ),
    },
    {
      key: 'filters',
      header: 'Filters',
      width: '90px',
      render: (c) => (
        <span className="tabular-nums text-[var(--text-secondary)]">
          {c.latestVersion?.filters.length ?? 0}
        </span>
      ),
    },
    {
      key: 'usedBy',
      header: 'Used by',
      width: '100px',
      render: (c) => (
        <Badge variant={c.usedByWorkflowCount > 0 ? 'info' : 'neutral'} size="sm">
          {c.usedByWorkflowCount} workflow{c.usedByWorkflowCount === 1 ? '' : 's'}
        </Badge>
      ),
    },
    {
      key: 'visibility',
      header: 'Visibility',
      width: '110px',
      render: (c) => (
        <Badge variant={c.visibility === 'shared' ? 'info' : 'neutral'} size="sm">
          {c.visibility}
        </Badge>
      ),
    },
    {
      key: 'updated',
      header: 'Updated',
      width: '120px',
      render: (c) => (
        <span className="text-[var(--text-secondary)]">{timeAgo(c.updatedAt)}</span>
      ),
    },
  ];

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <DataTable<CohortResponse>
          data={rows}
          columns={columns}
          keyExtractor={(c) => c.id}
          loading={isLoading}
          emptyTitle="No saved cohorts yet"
          emptyDescription="Save a filter you use often so workflows pick up new matching contacts as your data changes."
          onRowClick={(c) => setSelectedId(c.id)}
        />
      </div>

      <CreateCohortDialog
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(cohortId: string) => {
          setShowCreate(false);
          setSelectedId(cohortId);
        }}
      />

      {selectedId ? (
        <CohortDetailPane
          cohortId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </>
  );
}
