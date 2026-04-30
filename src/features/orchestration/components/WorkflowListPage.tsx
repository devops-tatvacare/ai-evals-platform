import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { routes } from '@/config/routes';
import { ApiError } from '@/services/api/client';
import { listWorkflows } from '@/services/api/orchestration';
import { notificationService } from '@/services/notifications';
import type { Workflow } from '@/features/orchestration/types';
import { CreateWorkflowDialog } from './CreateWorkflowDialog';

const columns: ColumnDef<Workflow>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (r) => <span className="text-[var(--text-primary)]">{r.name}</span>,
  },
  {
    key: 'workflowType',
    header: 'Type',
    render: (r) => (
      <span className="text-[var(--text-secondary)] uppercase">{r.workflowType}</span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (r) =>
      r.currentPublishedVersionId ? (
        <span className="text-[var(--color-success)]">Published</span>
      ) : (
        <span className="text-[var(--text-secondary)]">Draft</span>
      ),
  },
  {
    key: 'updatedAt',
    header: 'Updated',
    render: (r) => (
      <span className="text-[var(--text-secondary)]">
        {new Date(r.updatedAt).toLocaleString()}
      </span>
    ),
  },
];

export function WorkflowListPage() {
  const [rows, setRows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listWorkflows({ appId: 'inside-sales' }));
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to load campaigns';
      notificationService.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Campaigns</h1>
        <Button onClick={() => setShowCreate(true)}>New Campaign</Button>
      </div>
      <DataTable<Workflow>
        data={rows}
        columns={columns}
        keyExtractor={(r) => r.id}
        loading={loading}
        emptyTitle="No campaigns yet"
        emptyDescription="Create a campaign to start designing a workflow."
        onRowClick={(r) => navigate(routes.insideSales.campaignBuilder(r.id))}
      />
      {showCreate && (
        <CreateWorkflowDialog
          onClose={() => setShowCreate(false)}
          onCreated={(wf) => {
            setShowCreate(false);
            navigate(routes.insideSales.campaignBuilder(wf.id));
          }}
        />
      )}
    </div>
  );
}
