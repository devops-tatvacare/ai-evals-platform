import { useCallback, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

import { useCurrentAppId } from '@/hooks';
import { PageSurface, Tabs } from '@/components/ui';
import { apiLogsForApp } from '@/config/routes';
import { usePageMetadata } from '@/config/pageMetadata';
import { EvaluationRunsTab } from '../components/logs/EvaluationRunsTab';
import { SherlockTab } from '../components/logs/SherlockTab';
import { WorkflowActionsTab } from '../components/logs/WorkflowActionsTab';
import { WorkflowRunsTab } from '../components/logs/WorkflowRunsTab';

const TAB_EVALUATION_RUNS = 'evaluation-runs';
const TAB_WORKFLOW_RUNS = 'workflow-runs';
const TAB_WORKFLOW_ACTIONS = 'workflow-actions';
const TAB_SHERLOCK = 'sherlock';

const VALID_TABS = new Set<string>([
  TAB_EVALUATION_RUNS,
  TAB_WORKFLOW_RUNS,
  TAB_WORKFLOW_ACTIONS,
  TAB_SHERLOCK,
]);

/**
 * `/logs` is the single platform-wide log surface. The shell owns the active
 * tab via `?type=` so deep links and bookmarks stay stable while each tab
 * keeps its own filters inside the shared Logs page route.
 */
export default function Logs() {
  const appId = useCurrentAppId();
  const { icon, title } = usePageMetadata('logs');
  const [searchParams, setSearchParams] = useSearchParams();
  const [evaluationRunsSubtitle, setEvaluationRunsSubtitle] = useState<string>('');

  // Phase E — legacy bookmark redirect. Pre-Phase-A, evaluation-run drill-down
  // happened inline via `/logs?run_id=<id>`. The new contract is a routed
  // sub-page at `/<app>/logs/runs/<id>`. Redirect once on mount; preserve
  // any other params the caller had.
  const legacyRunId = searchParams.get('run_id');

  const rawType = searchParams.get('type');
  const activeTab = rawType && VALID_TABS.has(rawType) ? rawType : TAB_EVALUATION_RUNS;

  const handleTabChange = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams);
      params.set('type', next);
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const subtitle =
    activeTab === TAB_EVALUATION_RUNS
      ? evaluationRunsSubtitle
      : 'Activity logs across the platform';

  const tabs = useMemo(
    () => [
      {
        id: TAB_EVALUATION_RUNS,
        label: 'Evaluation runs',
        content: (
          <EvaluationRunsTab
            appId={appId}
            onSubtitleChange={setEvaluationRunsSubtitle}
          />
        ),
      },
      {
        id: TAB_WORKFLOW_RUNS,
        label: 'Workflow runs',
        content: <WorkflowRunsTab appId={appId} />,
      },
      {
        id: TAB_WORKFLOW_ACTIONS,
        label: 'Workflow actions',
        content: <WorkflowActionsTab appId={appId} />,
      },
      {
        id: TAB_SHERLOCK,
        label: 'Sherlock',
        content: <SherlockTab appId={appId} />,
      },
    ],
    [appId],
  );

  if (legacyRunId) {
    const params = new URLSearchParams(searchParams);
    params.delete('run_id');
    const qs = params.toString();
    const target = `${apiLogsForApp(appId)}/runs/${legacyRunId}${qs ? `?${qs}` : ''}`;
    return <Navigate to={target} replace />;
  }

  return (
    <PageSurface icon={icon} title={title} subtitle={subtitle}>
      <Tabs
        tabs={tabs}
        defaultTab={activeTab}
        onChange={handleTabChange}
        fillHeight
        // Phase E — only the active tab is mounted. Inactive tabs tear
        // down their `useQuery` subscriptions, so a user parked on
        // "Evaluation runs" doesn't burn polling budget on
        // `useRuns` (5s when in-flight runs exist) for the
        // Workflow runs tab.
        mountStrategy="active-only"
      />
    </PageSurface>
  );
}
