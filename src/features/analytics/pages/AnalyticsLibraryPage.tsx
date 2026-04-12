import { useEffect, useState, useCallback, useMemo } from 'react';
import { ChartArea, LayoutGrid, MoreVertical, Trash2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { notificationService } from '@/services/notifications';
import { Badge, VisibilityBadge, Popover, PopoverTrigger, PopoverContent } from '@/components/ui';
import { PageShell } from '@/components/ui/PageShell';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef } from '@/components/ui/DataTable';
import { ChartDetailView } from '../components/ChartDetailView';
import { DashboardView } from '../components/DashboardView';
import type { SavedChart, SavedDashboard } from '../types';

interface AnalyticsRow {
  id: string;
  title: string;
  itemType: 'chart' | 'dashboard';
  chartType?: string;
  description: string;
  source: string;
  visibility: 'private' | 'shared';
  updatedAt: string;
}

export function AnalyticsLibraryPage() {
  const appId = useAppStore((s) => s.currentApp);
  const [charts, setCharts] = useState<SavedChart[]>([]);
  const [dashboards, setDashboards] = useState<SavedDashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDashboardId, setActiveDashboardId] = useState<string | null>(null);
  const [activeChart, setActiveChart] = useState<SavedChart | null>(null);

  const loadCharts = useCallback(async () => {
    if (!appId) return;
    setLoading(true);
    try {
      const list = await analyticsLibraryApi.listCharts(appId);
      setCharts(list);
    } catch {
      // Silently fail — empty state is shown
    } finally {
      setLoading(false);
    }
  }, [appId]);

  const loadDashboards = useCallback(async () => {
    if (!appId) return;
    try {
      const list = await analyticsLibraryApi.listDashboards(appId);
      setDashboards(list);
    } catch {
      // Silently fail — empty state is shown
    }
  }, [appId]);

  useEffect(() => {
    loadCharts();
    loadDashboards();
  }, [loadCharts, loadDashboards]);

  const handleDeleteChart = useCallback(async (id: string) => {
    try {
      await analyticsLibraryApi.deleteChart(id);
      setCharts((prev) => prev.filter((c) => c.id !== id));
      notificationService.success('Chart deleted');
    } catch {
      notificationService.error('Failed to delete chart');
    }
  }, []);

  const handleDeleteDashboard = useCallback(async (id: string) => {
    try {
      await analyticsLibraryApi.deleteDashboard(id);
      setDashboards((prev) => prev.filter((d) => d.id !== id));
      notificationService.success('Dashboard deleted');
    } catch {
      notificationService.error('Failed to delete dashboard');
    }
  }, []);

  const handleMergeDashboard = useCallback(async () => {
    if (!appId || charts.length === 0) return;
    try {
      const dashboard = await analyticsLibraryApi.saveDashboard({
        appId,
        title: `Dashboard — ${new Date().toLocaleDateString()}`,
        chartIds: charts.map((c) => c.id),
      });
      setDashboards((prev) => [dashboard, ...prev]);
      notificationService.success('Dashboard created');
    } catch {
      notificationService.error('Failed to create dashboard');
    }
  }, [appId, charts]);

  const tableData = useMemo((): AnalyticsRow[] => {
    const chartRows: AnalyticsRow[] = charts.map((c) => ({
      id: c.id,
      title: c.title,
      itemType: 'chart',
      chartType: c.chartConfig.type,
      description: c.description.slice(0, 60),
      source: c.sourceQuestion?.slice(0, 50) ?? '',
      visibility: c.visibility,
      updatedAt: c.updatedAt,
    }));
    const dashRows: AnalyticsRow[] = dashboards.map((d) => ({
      id: d.id,
      title: d.title,
      itemType: 'dashboard',
      description: d.description.slice(0, 60),
      source: `${d.chartEntries.length} chart${d.chartEntries.length !== 1 ? 's' : ''}`,
      visibility: d.visibility,
      updatedAt: d.updatedAt,
    }));
    return [...chartRows, ...dashRows].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [charts, dashboards]);

  const handleRowClick = useCallback(
    (row: AnalyticsRow) => {
      if (row.itemType === 'chart') {
        const chart = charts.find((c) => c.id === row.id);
        if (chart) setActiveChart(chart);
      } else {
        setActiveDashboardId(row.id);
      }
    },
    [charts]
  );

  const columns = useMemo((): ColumnDef<AnalyticsRow>[] => [
    {
      key: 'title',
      header: 'Title',
      render: (row) => {
        const Icon = row.itemType === 'dashboard' ? LayoutGrid : ChartArea;
        return (
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-[var(--text-brand)]" />
            <span className="font-medium text-sm text-[var(--text-primary)]">{row.title}</span>
          </div>
        );
      },
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) =>
        row.itemType === 'chart' ? (
          <div>
            <Badge variant="info" size="sm">Chart</Badge>
            {row.chartType && (
              <span className="block text-[10px] text-[var(--text-muted)] mt-0.5">
                {row.chartType.replace('_', ' ')}
              </span>
            )}
          </div>
        ) : (
          <Badge variant="neutral" size="sm">Dashboard</Badge>
        ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (row) => (
        <span className="text-sm text-[var(--text-secondary)]">{row.description}</span>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      render: (row) =>
        row.itemType === 'chart' ? (
          <span className="text-sm italic text-[var(--text-secondary)]">{row.source}</span>
        ) : (
          <span className="text-sm text-[var(--text-secondary)]">{row.source}</span>
        ),
    },
    {
      key: 'visibility',
      header: 'Visibility',
      render: (row) => <VisibilityBadge visibility={row.visibility} compact />,
    },
    {
      key: 'updated',
      header: 'Updated',
      render: (row) => (
        <span className="text-sm text-[var(--text-secondary)]">
          {new Date(row.updatedAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Popover>
          <PopoverTrigger>
            <button
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-36 p-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (row.itemType === 'chart') {
                  handleDeleteChart(row.id);
                } else {
                  handleDeleteDashboard(row.id);
                }
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-[var(--color-error)] hover:bg-[var(--bg-tertiary)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </PopoverContent>
        </Popover>
      ),
    },
  ], [handleDeleteChart, handleDeleteDashboard]);

  // Full-page chart detail
  if (activeChart) {
    return <ChartDetailView chart={activeChart} onBack={() => setActiveChart(null)} />;
  }

  // Full-page dashboard detail
  if (activeDashboardId) {
    return <DashboardView dashboardId={activeDashboardId} onBack={() => setActiveDashboardId(null)} />;
  }

  return (
    <PageShell
      title="Analytics"
      subtitle={`${charts.length} charts, ${dashboards.length} dashboards`}
      headerActions={
        charts.length > 0 ? (
          <button
            onClick={handleMergeDashboard}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-[var(--color-brand-primary)] text-white hover:bg-[var(--color-brand-primary-hover)]"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Merge into Dashboard
          </button>
        ) : undefined
      }
    >
      <DataTable
        columns={columns}
        data={tableData}
        keyExtractor={(row) => row.id}
        onRowClick={handleRowClick}
        loading={loading}
        emptyIcon={ChartArea}
        emptyTitle="No analytics yet"
        emptyDescription="Ask Sherlock to visualize data — charts and dashboards appear here."
      />
    </PageShell>
  );
}
