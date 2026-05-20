import { Bell } from 'lucide-react';
import { PageSurface, Tabs } from '@/components/ui';
import { adminNotificationsCopy } from '../adminNotifications.copy';
import { DefaultsTab } from '../components/DefaultsTab';
import { SubscribersTab } from '../components/SubscribersTab';
import { SendLogTab } from '../components/SendLogTab';

export function AdminNotificationsPage() {
  return (
    <PageSurface icon={Bell} title={adminNotificationsCopy.adminTitle} subtitle={adminNotificationsCopy.adminSubtitle}>
      <Tabs
        tabs={[
          { id: 'defaults', label: adminNotificationsCopy.tab.defaults, content: <DefaultsTab /> },
          { id: 'subscribers', label: adminNotificationsCopy.tab.subscribers, content: <SubscribersTab /> },
          { id: 'sendLog', label: adminNotificationsCopy.tab.sendLog, content: <SendLogTab /> },
        ]}
        defaultTab="defaults"
        mountStrategy="active-only"
        fillHeight
      />
    </PageSurface>
  );
}
