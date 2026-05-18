import { useMemo } from 'react';

import { routes } from '@/config/routes';
import { useCurrentAppId } from '@/hooks';
import type { AppId } from '@/types';

/**
 * Per-app orchestration route helpers.
 *
 * Components inside the orchestration feature must NOT reference
 * ``routes.insideSales.campaign*`` directly — orchestration is a generic
 * surface, the same components mount under every app that hosts campaigns.
 * This hook resolves the right route group from the current app context.
 *
 * When a new app onboards orchestration (e.g. ``clinical``):
 *  1. Add ``campaigns`` / ``campaignBuilder`` / ``campaignRuns`` /
 *     ``campaignRunDetail`` / ``datasetDetail`` to ``routes.<app>``.
 *  2. Add a branch to ``RESOLVERS`` below.
 *  3. Mount the same orchestration components under the new app's URL tree
 *     in ``Router.tsx``.
 *
 * Components stay untouched.
 */
export interface OrchestrationRoutes {
  campaigns: string;
  campaignBuilder: (workflowId: string) => string;
  campaignRuns: string;
  campaignRunDetail: (runId: string) => string;
  /** Campaigns page deep-linked into the Datasets tab. Used for "back" buttons
   *  from dataset detail and cross-tab linking from workflow detail. */
  datasetsTab: string;
  datasetDetail: (datasetId: string) => string;
  /** Campaigns page deep-linked into the Cohorts tab. */
  cohortsTab: string;
}

const RESOLVERS: Partial<Record<AppId, OrchestrationRoutes>> = {
  'inside-sales': {
    campaigns: routes.insideSales.campaigns,
    campaignBuilder: routes.insideSales.campaignBuilder,
    campaignRuns: routes.insideSales.campaignRuns,
    campaignRunDetail: routes.insideSales.campaignRunDetail,
    datasetsTab: `${routes.insideSales.campaigns}?tab=datasets`,
    datasetDetail: routes.insideSales.datasetDetail,
    cohortsTab: `${routes.insideSales.campaigns}?tab=cohorts`,
  },
};

export function useOrchestrationRoutes(): OrchestrationRoutes {
  const appId = useCurrentAppId();
  return useMemo(() => {
    const resolved = RESOLVERS[appId];
    if (!resolved) {
      throw new Error(
        `useOrchestrationRoutes: app "${appId}" has no orchestration routes wired. ` +
          'Add an entry to RESOLVERS in useOrchestrationRoutes.ts when onboarding the app.',
      );
    }
    return resolved;
  }, [appId]);
}
