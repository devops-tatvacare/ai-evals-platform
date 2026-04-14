import { apiRequest } from './client';
import type { SavedChart, SavedDashboard, ChartDataResponse, DashboardDataResponse } from '@/features/analytics/types';

export const analyticsLibraryApi = {
  // Charts
  listCharts: (appId: string) =>
    apiRequest<SavedChart[]>(`/api/analytics-library/charts?app_id=${appId}`),

  saveChart: (payload: {
    appId: string;
    title: string;
    description?: string;
    sqlQuery: string;
    chartConfig: SavedChart['chartConfig'];
    sourceQuestion?: string;
    visibility?: string;
  }) => apiRequest<SavedChart>('/api/analytics-library/charts', { method: 'POST', body: JSON.stringify(payload) }),

  getChart: (chartId: string) =>
    apiRequest<SavedChart>(`/api/analytics-library/charts/${chartId}`),

  getChartData: (chartId: string) =>
    apiRequest<ChartDataResponse>(`/api/analytics-library/charts/${chartId}/data`),

  updateChart: (chartId: string, payload: { title?: string; description?: string; visibility?: string }) =>
    apiRequest<SavedChart>(`/api/analytics-library/charts/${chartId}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  deleteChart: (chartId: string) =>
    apiRequest(`/api/analytics-library/charts/${chartId}`, { method: 'DELETE' }),

  // Dashboards
  listDashboards: (appId: string) =>
    apiRequest<SavedDashboard[]>(`/api/analytics-library/dashboards?app_id=${appId}`),

  saveDashboard: (payload: {
    appId: string;
    title: string;
    description?: string;
    chartIds: string[];
    visibility?: string;
  }) => apiRequest<SavedDashboard>('/api/analytics-library/dashboards', { method: 'POST', body: JSON.stringify(payload) }),

  getDashboard: (dashboardId: string) =>
    apiRequest<SavedDashboard>(`/api/analytics-library/dashboards/${dashboardId}`),

  getDashboardData: (dashboardId: string) =>
    apiRequest<DashboardDataResponse>(`/api/analytics-library/dashboards/${dashboardId}/data`),

  updateDashboard: (dashboardId: string, payload: { title?: string; description?: string; visibility?: string }) =>
    apiRequest<SavedDashboard>(`/api/analytics-library/dashboards/${dashboardId}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  deleteDashboard: (dashboardId: string) =>
    apiRequest(`/api/analytics-library/dashboards/${dashboardId}`, { method: 'DELETE' }),
};
