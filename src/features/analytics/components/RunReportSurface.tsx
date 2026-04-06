import type { ReactNode } from 'react';
import KairaReportView from '@/features/evalRuns/components/report/KairaReportView';
import type { PlatformRunReportPayload } from '@/types/platformReports';

interface Props {
  report: PlatformRunReportPayload;
  runId: string;
  actions: ReactNode;
}

export function RunReportSurface({ report, runId, actions }: Props) {
  return <KairaReportView report={report} runId={runId} actions={actions} />;
}

export default RunReportSurface;
