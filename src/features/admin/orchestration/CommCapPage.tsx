import { useMemo, useState } from 'react';
import { Gauge, Plus } from 'lucide-react';

import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  LoadingState,
  PageSurface,
  type ColumnDef,
} from '@/components/ui';
import type { CommCapPolicy } from '@/services/api/orchestrationAdmin';
import { CommCapEditor } from './CommCapEditor';
import { useCommCapPolicies } from './queries';

function formatWindow(seconds: number): string {
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60} min`;
  }
  return `${seconds}s`;
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function CommCapPage() {
  const { data: policies = [], isLoading } = useCommCapPolicies();
  const [editorState, setEditorState] = useState<
    { mode: 'create' } | { mode: 'edit'; policy: CommCapPolicy } | null
  >(null);

  const existingAppIds = useMemo(() => policies.map((p) => p.appId), [policies]);

  const columns = useMemo<ColumnDef<CommCapPolicy>[]>(
    () => [
      {
        key: 'app',
        header: 'App',
        width: 'min-w-[160px]',
        render: (p) => (
          <span className="font-mono text-[length:var(--text-table-cell)] text-[var(--text-primary)]">
            {p.appId}
          </span>
        ),
      },
      {
        key: 'max-count',
        header: 'Max reach',
        width: 'w-[110px]',
        render: (p) => <span className="text-[var(--text-primary)]">{p.maxCount}</span>,
      },
      {
        key: 'window',
        header: 'Window',
        width: 'w-[120px]',
        render: (p) => (
          <span className="text-[var(--text-secondary)]">{formatWindow(p.windowSeconds)}</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        width: 'w-[110px]',
        render: (p) =>
          p.isActive ? (
            <Badge variant="success">Enforced</Badge>
          ) : (
            <Badge variant="neutral">Off</Badge>
          ),
      },
      {
        key: 'updated',
        header: 'Updated',
        width: 'w-[150px]',
        render: (p) => (
          <span className="text-[var(--text-muted)]">{formatAbsolute(p.updatedAt)}</span>
        ),
      },
    ],
    [],
  );

  return (
    <PageSurface
      icon={Gauge}
      title="Contact reach limits"
      subtitle="Set how often a single contact can be reached, per app."
      actions={
        <Button
          variant="primary"
          size="sm"
          icon={Plus}
          onClick={() => setEditorState({ mode: 'create' })}
        >
          Add reach limit
        </Button>
      }
    >
      {isLoading ? (
        <LoadingState />
      ) : policies.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title="No reach limits yet"
          description="Add a limit to cap how often a single contact is messaged or called per app."
          fill
        />
      ) : (
        <DataTable
          columns={columns}
          data={policies}
          keyExtractor={(p) => p.id}
          onRowClick={(p) => setEditorState({ mode: 'edit', policy: p })}
        />
      )}

      {editorState && (
        <CommCapEditor
          key={editorState.mode === 'edit' ? editorState.policy.id : 'create'}
          policy={editorState.mode === 'edit' ? editorState.policy : null}
          existingAppIds={existingAppIds}
          onClose={() => setEditorState(null)}
        />
      )}
    </PageSurface>
  );
}
