import { Tabs } from '@/components/ui/Tabs';
import { useInlineReviewNavigationGuard } from './useInlineReviewNavigationGuard';

export function ReviewAwareTabs(props: Parameters<typeof Tabs>[0]) {
  const { confirmNavigation, guardModal } = useInlineReviewNavigationGuard();

  return (
    <>
      <Tabs
        {...props}
        beforeChange={(_tabId, commit) => {
          confirmNavigation(commit);
        }}
      />
      {guardModal}
    </>
  );
}
