import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LoadingState } from '@/components/ui';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { ChartDetailView } from '../components/ChartDetailView';
import type { SavedChart } from '../types';

export function AnalyticsChartDetail() {
  const { chartId } = useParams<{ chartId: string }>();
  const navigate = useNavigate();
  const [chart, setChart] = useState<SavedChart | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chartId) return;
    setLoading(true);
    analyticsLibraryApi
      .getChart(chartId)
      .then(setChart)
      .catch(() => navigate(-1))
      .finally(() => setLoading(false));
  }, [chartId, navigate]);

  if (loading || !chart) {
    return <LoadingState />;
  }

  return (
    <ChartDetailView
      chart={chart}
      onBack={() => navigate(-1)}
      onDelete={() => navigate(-1)}
      onUpdate={setChart}
    />
  );
}
