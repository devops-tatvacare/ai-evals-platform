import { useEffect, useState, useCallback } from 'react';
import { ChartArea, LayoutGrid } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAppStore } from '@/stores/appStore';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { notificationService } from '@/services/notifications';
import { EmptyState } from '@/components/ui';
import { ChartCard } from '../components/ChartCard';
import { DashboardView } from '../components/DashboardView';
import type { SavedChart, SavedDashboard } from '../types';

type Tab = 'charts' | 'dashboards';

export function AnalyticsLibraryPage() {
  const appId = useAppStore((s) => s.currentApp);
  const [tab, setTab] = useState<Tab>('charts');
  const [charts, setCharts] = useState<SavedChart[]>([]);
  const [dashboards, setDashboards] = useState<SavedDashboard[]>([]);
  const [chartData, setChartData] = useState<Record<string, Record<string, unknown>[]>>({});
  const [loading, setLoading] = useState(true);
  const [activeDashboardId, setActiveDashboardId] = useState<string | null>(null);

  const loadCharts = useCallback(async () => {
    if (!appId) return;
    setLoading(true);
    try {
      const list = await analyticsLibraryApi.listCharts(appId);
      setCharts(list);
      for (const chart of list) {
        analyticsLibraryApi.getChartData(chart.id).then((res) => {
          setChartData((prev) => ({ ...prev, [chart.id]: res.data }));
        }).catch(() => {});
      }
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

  const handleDeleteChart = async (id: string) => {
    try {
      await analyticsLibraryApi.deleteChart(id);
      setCharts((prev) => prev.filter((c) => c.id !== id));
      notificationService.success('Chart deleted');
    } catch {
      notificationService.error('Failed to delete chart');
    }
  };

  const handleMergeDashboard = async () => {
    if (!appId || charts.length === 0) return;
    try {
      const dashboard = await analyticsLibraryApi.saveDashboard({
        appId,
        title: `Dashboard — ${new Date().toLocaleDateString()}`,
        chartIds: charts.map((c) => c.id),
      });
      setDashboards((prev) => [dashboard, ...prev]);
      notificationService.success('Dashboard created');
      setTab('dashboards');
    } catch {
      notificationService.error('Failed to create dashboard');
    }
  };

  if (activeDashboardId) {
    return (
      <DashboardView
        dashboardId={activeDashboardId}
        onBack={() => setActiveDashboardId(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-2">
          <ChartArea className="h-5 w-5 text-[var(--color-brand-primary)]" />
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Analytics</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--border-default)] overflow-hidden">
            <button
              onClick={() => setTab('charts')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium',
                tab === 'charts'
                  ? 'bg-[var(--color-brand-accent)] text-[var(--color-brand-primary)]'
                  : 'text-[var(--text-muted)]',
              )}
            >
              Charts ({charts.length})
            </button>
            <button
              onClick={() => setTab('dashboards')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium',
                tab === 'dashboards'
                  ? 'bg-[var(--color-brand-accent)] text-[var(--color-brand-primary)]'
                  : 'text-[var(--text-muted)]',
              )}
            >
              Dashboards ({dashboards.length})
            </button>
          </div>
          {tab === 'charts' && charts.length > 0 && (
            <button
              onClick={handleMergeDashboard}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-[var(--color-brand-primary)] text-white hover:bg-[var(--color-brand-primary-hover)]"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Merge into Dashboard
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'charts' && (
          charts.length === 0 && !loading ? (
            <div className="flex items-center justify-center h-full">
              <EmptyState
                icon={ChartArea}
                title="No charts yet"
                description="Ask Sherlock to visualize data — charts appear here."
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {charts.map((chart) => (
                <ChartCard
                  key={chart.id}
                  chart={chart}
                  data={chartData[chart.id]}
                  loading={!chartData[chart.id]}
                  onDelete={handleDeleteChart}
                  onClick={() => {/* TODO: expand/detail view */}}
                />
              ))}
            </div>
          )
        )}

        {tab === 'dashboards' && (
          dashboards.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <EmptyState
                icon={LayoutGrid}
                title="No dashboards yet"
                description="Save charts from Sherlock, then merge them into a dashboard."
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {dashboards.map((d) => (
                <div
                  key={d.id}
                  onClick={() => setActiveDashboardId(d.id)}
                  className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 cursor-pointer hover:border-[var(--color-brand-primary)] transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <LayoutGrid className="h-4 w-4 text-[var(--color-brand-primary)]" />
                    <span className="text-sm font-medium text-[var(--text-primary)]">{d.title}</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    {d.chartEntries.length} chart{d.chartEntries.length !== 1 ? 's' : ''} &middot; {d.visibility}
                  </p>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
