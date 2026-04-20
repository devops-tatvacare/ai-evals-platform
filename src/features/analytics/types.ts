import type {
  SeriesConfig,
  VegaLiteSpec,
} from '@/features/chat-widget/types';

export interface SavedChartRendererConfig {
  type: string;
  xKey: string;
  yKey?: string;
  seriesKeys?: string[];
  series?: SeriesConfig[];
  xLabel?: string;
  yLabel?: string;
  legendPosition?: 'top' | 'bottom' | 'right' | 'none';
  title?: string;
  colorMap?: Record<string, string>;
}

export interface SavedChartCanonicalConfig {
  kind: 'chart';
  spec: VegaLiteSpec;
}

export interface SavedChartConfig {
  canonical?: SavedChartCanonicalConfig | null;
  renderer: SavedChartRendererConfig;
}

export interface SavedChart {
  id: string;
  appId: string;
  title: string;
  description: string;
  sqlQuery: string;
  chartConfig: SavedChartConfig;
  sourceQuestion?: string;
  sourceSessionId?: string | null;
  visibility: 'private' | 'shared';
  createdAt: string;
  updatedAt: string;
}

export interface SavedDashboard {
  id: string;
  appId: string;
  title: string;
  description: string;
  chartEntries: Array<{ chartId: string; width: 'half' | 'full'; order: number }>;
  sourceSessionId?: string | null;
  visibility: 'private' | 'shared';
  createdAt: string;
  updatedAt: string;
}

export interface ChartDataResponse {
  data: Record<string, unknown>[];
  rowCount: number;
}

export interface DashboardDataResponse {
  dashboard: SavedDashboard;
  charts: Array<{
    chartId: string;
    title?: string;
    chartConfig?: SavedChartConfig;
    data?: Record<string, unknown>[];
    rowCount?: number;
    width: string;
    order: number;
    error?: string;
  }>;
}
