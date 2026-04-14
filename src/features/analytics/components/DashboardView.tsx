import { useEffect, useState } from 'react';
import { RefreshCw, ArrowLeft } from 'lucide-react';
import { cn } from '@/utils/cn';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { notificationService } from '@/services/notifications';
import { ChartRenderer } from './ChartRenderer';
import type { DashboardDataResponse } from '../types';

interface DashboardViewProps {
  dashboardId: string;
  onBack: () => void;
}

export function DashboardView({ dashboardId, onBack }: DashboardViewProps) {
  const [data, setData] = useState<DashboardDataResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const result = await analyticsLibraryApi.getDashboardData(dashboardId);
      setData(result);
    } catch {
      notificationService.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [dashboardId]);

  if (loading || !data) {
    return <div className="flex items-center justify-center h-64 text-sm text-[var(--text-muted)]">Loading dashboard...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 rounded hover:bg-[var(--bg-tertiary)]">
            <ArrowLeft className="h-4 w-4 text-[var(--text-muted)]" />
          </button>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{data.dashboard.title}</h2>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {data.charts
            .sort((a, b) => a.order - b.order)
            .map((entry) => (
              <div
                key={entry.chartId}
                className={cn(
                  'rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4',
                  entry.width === 'full' && 'lg:col-span-2',
                )}
              >
                {entry.error ? (
                  <div className="text-xs text-[var(--color-verdict-fail)]">Error: {entry.error}</div>
                ) : (
                  <>
                    <h3 className="text-xs font-medium text-[var(--text-primary)] mb-2">{entry.title}</h3>
                    <ChartRenderer
                      type={entry.chartConfig!.type}
                      data={entry.data || []}
                      xKey={entry.chartConfig!.xKey}
                      yKey={entry.chartConfig!.yKey}
                      seriesKeys={entry.chartConfig!.seriesKeys}
                      series={entry.chartConfig!.series}
                      xLabel={entry.chartConfig!.xLabel}
                      yLabel={entry.chartConfig!.yLabel}
                      legendPosition={entry.chartConfig!.legendPosition}
                      height={280}
                    />
                  </>
                )}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
