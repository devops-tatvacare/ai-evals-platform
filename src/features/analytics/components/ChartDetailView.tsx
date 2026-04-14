import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { notificationService } from '@/services/notifications';
import { ChartRenderer } from './ChartRenderer';
import type { SavedChart } from '../types';

interface ChartDetailViewProps {
  chart: SavedChart;
  onBack: () => void;
}

export function ChartDetailView({ chart, onBack }: ChartDetailViewProps) {
  const [data, setData] = useState<Record<string, unknown>[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const result = await analyticsLibraryApi.getChartData(chart.id);
      setData(result.data);
    } catch {
      notificationService.error('Failed to load chart data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [chart.id]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 rounded hover:bg-[var(--bg-tertiary)]">
            <ArrowLeft className="h-4 w-4 text-[var(--text-muted)]" />
          </button>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{chart.title}</h2>
            {chart.sourceQuestion && (
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{chart.sourceQuestion}</p>
            )}
          </div>
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
        {loading || !data ? (
          <div className="flex items-center justify-center h-64 text-sm text-[var(--text-muted)]">Loading chart...</div>
        ) : (
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-6">
            <ChartRenderer
              type={chart.chartConfig.type}
              data={data}
              xKey={chart.chartConfig.xKey}
              yKey={chart.chartConfig.yKey}
              seriesKeys={chart.chartConfig.seriesKeys}
              series={chart.chartConfig.series}
              xLabel={chart.chartConfig.xLabel}
              yLabel={chart.chartConfig.yLabel}
              legendPosition={chart.chartConfig.legendPosition}
              height={500}
            />
          </div>
        )}
      </div>
    </div>
  );
}
