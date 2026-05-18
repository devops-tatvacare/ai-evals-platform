import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PageSurface } from '@/components/ui/PageSurface';
import { Tabs } from '@/components/ui/Tabs';
import { usePageMetadata } from '@/config/pageMetadata';
import { useAuthStore } from '@/stores/authStore';
import { canManageOrchestration } from '@/features/orchestration/utils/access';

import { CohortsTab } from './CohortsTab';
import { DatasetsTab } from './DatasetsTab';
import { NewCampaignMenu, type CampaignKind } from './NewCampaignMenu';
import { WorkflowsTab } from './WorkflowsTab';

type TabKey = 'workflows' | 'datasets' | 'cohorts';

const VALID_TABS: ReadonlySet<TabKey> = new Set<TabKey>(['workflows', 'datasets', 'cohorts']);

function parseTab(raw: string | null): TabKey {
  if (raw && (VALID_TABS as Set<string>).has(raw)) return raw as TabKey;
  return 'workflows';
}

export function CampaignsPage() {
  const { icon, title } = usePageMetadata('campaigns');
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseTab(searchParams.get('tab'));
  const highlightId = searchParams.get('highlight');
  const user = useAuthStore((s) => s.user);
  const canManage = canManageOrchestration(user);

  // Each tab owns its create-dialog open state by default. CampaignsPage
  // hoists the open flag for whichever kind the [+ New ▾] menu requests so
  // a click on "Workflow" lands in the Workflows tab and opens its dialog.
  const [pendingCreate, setPendingCreate] = useState<CampaignKind | null>(null);

  function handleNew(kind: CampaignKind) {
    const tabFor: Record<CampaignKind, TabKey> = {
      workflow: 'workflows',
      dataset: 'datasets',
      cohort: 'cohorts',
    };
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tabFor[kind]);
      next.delete('highlight');
      return next;
    });
    setPendingCreate(kind);
  }

  function setTab(next: TabKey) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('tab', next);
      p.delete('highlight');
      return p;
    });
  }

  const tabs = useMemo(
    () => [
      {
        id: 'workflows',
        label: 'Workflows',
        content: (
          <WorkflowsTab
            showCreate={pendingCreate === 'workflow'}
            onShowCreateChange={(next) => {
              if (!next) setPendingCreate(null);
            }}
          />
        ),
      },
      {
        id: 'datasets',
        label: 'Datasets',
        content: (
          <DatasetsTab
            showCreate={pendingCreate === 'dataset'}
            onShowCreateChange={(next) => {
              if (!next) setPendingCreate(null);
            }}
          />
        ),
      },
      {
        id: 'cohorts',
        label: 'Cohorts',
        content: (
          <CohortsTab
            showCreate={pendingCreate === 'cohort'}
            onShowCreateChange={(next) => {
              if (!next) setPendingCreate(null);
            }}
            highlightId={highlightId}
          />
        ),
      },
    ],
    [pendingCreate, highlightId],
  );

  return (
    <PageSurface
      icon={icon}
      title={title}
      actions={canManage ? <NewCampaignMenu onCreate={handleNew} /> : null}
    >
      <Tabs
        tabs={tabs}
        defaultTab={activeTab}
        onChange={(id) => setTab(id as TabKey)}
        fillHeight
        mountStrategy="active-only"
      />
    </PageSurface>
  );
}
