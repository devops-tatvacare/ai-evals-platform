import { ReviewAwareTabs } from '@/features/reviews/inline';
import type { RunDetailTab } from './types';

interface Props {
  tabs: RunDetailTab[];
  defaultTab?: string;
}

/**
 * The shared tab strip for the run-detail surface. This is the single home of
 * the `fillHeight` + `flex-1 / min-h-0` scroll wiring — every app entry renders
 * its tabs through here, so the vertical-scroll bug class cannot recur per app.
 */
export function RunDetailTabStrip({ tabs, defaultTab = 'results' }: Props) {
  return (
    <div className="flex-1 min-h-0">
      <ReviewAwareTabs tabs={tabs} defaultTab={defaultTab} fillHeight />
    </div>
  );
}

export default RunDetailTabStrip;
