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
  /** Eval run display name from the parent run-detail page — used by the
   *  empty-state hero so the title is the user's run, not "Default Single Run Report". */
  runName?: string | null;
}

export function AppReportTab({ appId, runId, runName }: Props) {
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

  // Contract-driven preview of what the report will contain — sourced from
  // app config so adding/removing a section in the seed updates the empty
  // state automatically. Filter out sections without a title (defensive —
  // backend default makes title required, but the type is optional).
  const sectionsPreview = appConfig.analytics.singleRun.sections
    .filter((section) => Boolean(section.title))
    .map((section) => ({ id: section.id, title: section.title as string }));

  return (
    <ReportTab<PlatformRunReportPayload>
      appId={appId}
      runId={runId}
      runName={runName}
      sectionsPreview={sectionsPreview}
      supportsPdf={appConfig.analytics.capabilities.pdfExport}
      renderReport={(report, actions) => <RunReportSurface report={report} runId={runId} actions={actions} />}
    />
  );
}
