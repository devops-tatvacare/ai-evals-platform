import { useState, useEffect } from 'react';
import { HardDrive, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui';
import { getStorageUsageByTable, type TableStorageInfo } from '@/services/storage/db';
import { formatFileSize } from '@/utils';

const TABLE_COLORS: Record<string, string> = {
  files: 'var(--color-brand-primary)',
  listings: 'var(--color-info)',
  entities: 'var(--color-warning)',
  history: 'var(--color-success)',
};

const TABLE_LABELS: Record<string, string> = {
  files: 'Audio Files',
  listings: 'Listings',
  entities: 'Entities',
  history: 'History',
};

export function StorageUsagePanel() {
  const [tables, setTables] = useState<TableStorageInfo[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [quota, setQuota] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchStorage = async () => {
    setIsLoading(true);
    try {
      const usage = await getStorageUsageByTable();
      setTables(usage.tables);
      setTotalBytes(usage.totalBytes);
      setQuota(usage.quota);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStorage();
  }, []);

  const quotaPercentage = quota > 0 ? (totalBytes / quota) * 100 : 0;

  // Sort tables by size descending for display
  const sortedTables = [...tables].sort((a, b) => b.estimatedBytes - a.estimatedBytes);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-[var(--text-muted)]" />
          <span className="text-[13px] font-medium text-[var(--text-primary)]">
            IndexedDB Storage
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchStorage}
          disabled={isLoading}
          className="h-7 px-2 text-[11px]"
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Total usage */}
      <div>
        <div className="flex justify-between text-[12px] mb-1.5">
          <span className="text-[var(--text-secondary)]">Total Usage</span>
          <span className="text-[var(--text-primary)] font-medium">
            {formatFileSize(totalBytes)}
            {quota > 0 && (
              <span className="text-[var(--text-muted)] font-normal">
                {' '}/ {formatFileSize(quota)} ({quotaPercentage.toFixed(2)}%)
              </span>
            )}
          </span>
        </div>

        {/* Stacked horizontal bar */}
        <div className="h-3 rounded-full bg-[var(--bg-tertiary)] overflow-hidden flex">
          {totalBytes > 0 && sortedTables.map((table) => {
            const pct = (table.estimatedBytes / totalBytes) * 100;
            if (pct < 0.5) return null;
            return (
              <div
                key={table.name}
                className="h-full transition-all duration-300"
                style={{
                  width: `${pct}%`,
                  backgroundColor: TABLE_COLORS[table.name] ?? 'var(--text-muted)',
                }}
                title={`${TABLE_LABELS[table.name] ?? table.name}: ${formatFileSize(table.estimatedBytes)} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>
      </div>

      {/* Per-table breakdown */}
      <div className="space-y-2.5">
        {sortedTables.map((table) => {
          const pct = totalBytes > 0 ? (table.estimatedBytes / totalBytes) * 100 : 0;
          const color = TABLE_COLORS[table.name] ?? 'var(--text-muted)';
          const label = TABLE_LABELS[table.name] ?? table.name;

          return (
            <div key={table.name} className="flex items-center gap-3">
              {/* Color swatch */}
              <div
                className="h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: color }}
              />
              {/* Label + count */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[12px] font-medium text-[var(--text-primary)]">
                    {label}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {table.count} {table.count === 1 ? 'record' : 'records'}
                  </span>
                </div>
              </div>
              {/* Size + percentage */}
              <div className="text-right shrink-0">
                <span className="text-[12px] text-[var(--text-primary)]">
                  {formatFileSize(table.estimatedBytes)}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] ml-1">
                  ({pct.toFixed(1)}%)
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-[var(--text-muted)]">
        Storage includes audio files, transcripts, evaluations, and configuration data stored locally in your browser.
      </p>
    </div>
  );
}
