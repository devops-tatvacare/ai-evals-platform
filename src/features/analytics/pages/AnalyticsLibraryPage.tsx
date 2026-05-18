import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChartArea, LayoutGrid, MoreVertical, Trash2, Share2, Lock, Pencil } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { notificationService } from '@/services/notifications';
import { Badge, VisibilityBadge, Popover, PopoverTrigger, PopoverContent, PageSurface } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { useAppConfig } from '@/hooks';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef } from '@/components/ui/DataTable';
import type { SavedChart, SavedDashboard } from '../types';
import { PlatformCrossRunReport } from '../components/PlatformReportRenderer';

/** Short display labels for chart types — keeps badges compact. */
const CHART_TYPE_LABELS: Record<string, string> = {
  bar: 'Bar',
  horizontal_bar: 'H. Bar',
  stacked_bar: 'Stacked',
  grouped_bar: 'Grouped',
  line: 'Line',
  area: 'Area',
  stacked_area: 'Stacked Area',
  pie: 'Pie',
  donut: 'Donut',
  scatter: 'Scatter',
  radar: 'Radar',
  funnel: 'Funnel',
  treemap: 'Treemap',
  radial_bar: 'Radial',
  composed: 'Composed',
};

interface AnalyticsRow {
  id: string;
  title: string;
  itemType: 'chart' | 'dashboard';
  chartType?: string;
  description: string;
  visibility: 'private' | 'shared';
  updatedAt: string;
}

export function AnalyticsLibraryPage() {
  const appId = useAppStore((s) => s.currentApp);
  const appConfig = useAppConfig(appId);
  const navigate = useNavigate();
  const [charts, setCharts] = useState<SavedChart[]>([]);
  const [dashboards, setDashboards] = useState<SavedDashboard[]>([]);
  const [loading, setLoading] = useState(true);

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

  const handleToggleChartVisibility = useCallback(async (id: string, current: 'private' | 'shared') => {
    const newVis = current === 'shared' ? 'private' : 'shared';
    try {
      const updated = await analyticsLibraryApi.updateChart(id, { visibility: newVis });
      setCharts((prev) => prev.map((c) => (c.id === id ? updated : c)));
      notificationService.success(newVis === 'shared' ? 'Chart shared' : 'Chart set to private');
    } catch {
      notificationService.error('Failed to update visibility');
    }
  }, []);

  const handleToggleDashboardVisibility = useCallback(async (id: string, current: 'private' | 'shared') => {
    const newVis = current === 'shared' ? 'private' : 'shared';
    try {
      const updated = await analyticsLibraryApi.updateDashboard(id, { visibility: newVis });
      setDashboards((prev) => prev.map((d) => (d.id === id ? updated : d)));
      notificationService.success(newVis === 'shared' ? 'Dashboard shared' : 'Dashboard set to private');
    } catch {
      notificationService.error('Failed to update visibility');
    }
  }, []);


  const tableData = useMemo((): AnalyticsRow[] => {
    const chartRows: AnalyticsRow[] = charts.map((c) => ({
      id: c.id,
      title: c.title,
      itemType: 'chart',
      chartType: c.chartConfig.renderer.type,
      description: c.sourceQuestion?.slice(0, 80) || c.description.slice(0, 80),
      visibility: c.visibility,
      updatedAt: c.updatedAt,
    }));
    const dashRows: AnalyticsRow[] = dashboards.map((d) => ({
      id: d.id,
      title: d.title,
      itemType: 'dashboard',
      description: d.description.slice(0, 80) || `${d.chartEntries.length} chart${d.chartEntries.length !== 1 ? 's' : ''}`,
      visibility: d.visibility,
      updatedAt: d.updatedAt,
    }));
    return [...chartRows, ...dashRows].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [charts, dashboards]);

  const handleRowClick = useCallback((row: AnalyticsRow) => {
    if (row.itemType === 'chart') {
      navigate(`charts/${row.id}`);
    } else {
      navigate(`dashboards/${row.id}`);
    }
  }, [navigate]);

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
        row.itemType === 'dashboard' ? (
          <Badge variant="neutral" size="sm" icon={LayoutGrid}>Dashboard</Badge>
        ) : (
          <Badge variant="info" size="sm" icon={ChartArea}>
            {CHART_TYPE_LABELS[row.chartType ?? ''] ?? row.chartType?.replace(/_/g, ' ') ?? 'Chart'}
          </Badge>
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
      key: 'visibility',
      header: 'Visibility',
      render: (row) => <VisibilityBadge visibility={row.visibility} compact />,
    },
    {
      key: 'updated',
      header: 'Updated',
      textBehavior: 'nowrap',
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
          <PopoverTrigger asChild>
            <button
              className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-44 p-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(row.itemType === 'chart' ? `charts/${row.id}` : `dashboards/${row.id}`);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (row.itemType === 'chart') {
                  handleToggleChartVisibility(row.id, row.visibility);
                } else {
                  handleToggleDashboardVisibility(row.id, row.visibility);
                }
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            >
              {row.visibility === 'shared' ? (
                <><Lock className="h-3.5 w-3.5" /> Make Private</>
              ) : (
                <><Share2 className="h-3.5 w-3.5" /> Share</>
              )}
            </button>
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
  ], [handleDeleteChart, handleDeleteDashboard, handleToggleChartVisibility, handleToggleDashboardVisibility, navigate]);

  const { icon, title } = usePageMetadata('analytics');
  const showCrossRunHero = Boolean(appId) && appConfig.analytics.capabilities.crossRunAnalytics;

  return (
    <PageSurface icon={icon} title={title}>
      <div className="space-y-8">
        {showCrossRunHero && appId ? <PlatformCrossRunReport appId={appId} /> : null}
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
      </div>
    </PageSurface>
  );
}
