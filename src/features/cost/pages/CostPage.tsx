import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Button, PageShell, Tabs } from '@/components/ui';
import { useCostStore } from '@/stores/costStore';
import { CostFiltersBar } from '../components/CostFiltersBar';
import { OverviewTab } from '../tabs/OverviewTab';
import { SpendTab } from '../tabs/SpendTab';
import { EntitiesTab } from '../tabs/EntitiesTab';
import { CallsTab } from '../tabs/CallsTab';
import { EfficiencyTab } from '../tabs/EfficiencyTab';
import { PricingTab } from '../tabs/PricingTab';

type TabId = 'overview' | 'spend' | 'entities' | 'calls' | 'efficiency' | 'pricing';

const TAB_IDS: readonly TabId[] = ['overview', 'spend', 'entities', 'calls', 'efficiency', 'pricing'];

function isTabId(value: string | null): value is TabId {
  return value !== null && (TAB_IDS as readonly string[]).includes(value);
}

export function CostPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabId = isTabId(tabParam) ? tabParam : 'overview';

  const refreshActive = useCostStore((s) => s.refreshActive);

  const handleTabChange = useCallback(
    (tabId: string) => {
      if (!isTabId(tabId)) return;
      const next = new URLSearchParams(searchParams);
      if (tabId === 'overview') next.delete('tab');
      else next.set('tab', tabId);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const tabs = useMemo(
    () => [
      { id: 'overview', label: 'Overview', content: <OverviewTab active={activeTab === 'overview'} /> },
      { id: 'spend', label: 'Spend', content: <SpendTab active={activeTab === 'spend'} /> },
      { id: 'entities', label: 'Entities', content: <EntitiesTab active={activeTab === 'entities'} /> },
      { id: 'calls', label: 'Calls', content: <CallsTab active={activeTab === 'calls'} /> },
      { id: 'efficiency', label: 'Efficiency', content: <EfficiencyTab active={activeTab === 'efficiency'} /> },
      { id: 'pricing', label: 'Pricing', content: <PricingTab active={activeTab === 'pricing'} /> },
    ],
    [activeTab],
  );

  return (
    <PageShell
      title="Cost & Usage"
      subtitle="LLM spend and token usage for this tenant, plus pricing history"
      headerActions={
        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          onClick={() => refreshActive(activeTab)}
        >
          Refresh
        </Button>
      }
      filterSlot={<CostFiltersBar />}
    >
      <Tabs
        tabs={tabs}
        defaultTab={activeTab}
        onChange={handleTabChange}
        mountStrategy="active-only"
        fillHeight
      />
    </PageShell>
  );
}
