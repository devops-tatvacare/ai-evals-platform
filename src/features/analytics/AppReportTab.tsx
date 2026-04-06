import type { AppId } from '@/types';
import { FileBarChart } from 'lucide-react';
import { useAppConfig } from '@/hooks';
import { EmptyState } from '@/components/ui';
import ReportTab from '@/features/evalRuns/components/report/ReportTab';
import type { PlatformRunReportPayload } from '@/types/platformReports';
import { RunReportSurface } from './components/RunReportSurface';

interface Props {
  appId: AppId;
  runId: string;
}

export function AppReportTab({ appId, runId }: Props) {
  const appConfig = useAppConfig(appId);

  if (!appConfig.analytics.capabilities.singleRunReport) {
    return (
      <EmptyState
        icon={FileBarChart}
        title="Reports are not available"
        description="This app does not expose a report renderer yet."
        compact
      />
    );
  }

  return (
    <ReportTab<PlatformRunReportPayload>
      appId={appId}
      runId={runId}
      supportsPdf={appConfig.analytics.capabilities.pdfExport}
      renderReport={(report, actions) => <RunReportSurface report={report} runId={runId} actions={actions} />}
    />
  );
}
