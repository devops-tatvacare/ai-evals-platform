import type { ReactNode } from 'react';
import { PlatformReportView } from '@/features/analytics/components/PlatformReportRenderer';
import type { PlatformRunReportPayload } from '@/types/platformReports';

interface Props {
  report: PlatformRunReportPayload;
  runId: string;
  actions: ReactNode;
}

export function RunReportSurface({ report, runId, actions }: Props) {
  void runId;
  return <PlatformReportView report={report} actions={actions} />;
}

export default RunReportSurface;
