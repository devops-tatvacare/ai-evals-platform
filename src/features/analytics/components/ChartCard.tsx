import { Trash2, Share2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { ChartRenderer } from './ChartRenderer';
import type { SavedChart } from '../types';

interface ChartCardProps {
  chart: SavedChart;
  data?: Record<string, unknown>[];
  loading?: boolean;
  onDelete: (id: string) => void;
  onClick: (id: string) => void;
}

export function ChartCard({ chart, data, loading, onDelete, onClick }: ChartCardProps) {
  return (
    <div
      onClick={() => onClick(chart.id)}
      className={cn(
        'group rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)]',
        'cursor-pointer hover:border-[var(--color-brand-primary)] transition-colors',
        'overflow-hidden',
      )}
    >
      {/* Chart thumbnail */}
      <div className="h-40 p-2 pointer-events-none">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-[var(--text-muted)]">Loading...</div>
        ) : data ? (
          <ChartRenderer
            type={chart.chartConfig.type}
            data={data}
            xKey={chart.chartConfig.xKey}
            yKey={chart.chartConfig.yKey}
            seriesKeys={chart.chartConfig.seriesKeys}
            height={144}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-[var(--text-muted)]">No data</div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--border-subtle)] px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-primary)] truncate">{chart.title}</span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {chart.visibility === 'shared' && <Share2 className="h-3 w-3 text-[var(--text-muted)]" />}
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(chart.id); }}
              className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--color-verdict-fail)]"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
        {chart.sourceQuestion && (
          <p className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{chart.sourceQuestion}</p>
        )}
      </div>
    </div>
  );
}
