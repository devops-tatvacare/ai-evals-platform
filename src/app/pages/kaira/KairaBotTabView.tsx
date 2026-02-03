/**
 * Kaira Bot Tab View
 * Main view with Chat and Trace Analysis tabs (similar to Voice Rx pattern)
 */

import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';
import { Tabs } from '@/components/ui';
import { ChatView } from '@/features/kaira/components/ChatView';
import { TraceAnalysisView } from '@/features/kaira/components';
import { useKairaChat } from '@/hooks';

export function KairaBotTabView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentSession, messages, isSessionsLoaded } = useKairaChat();

  // Get active tab from URL or default to 'chat'
  const activeTab = searchParams.get('tab') || 'chat';

  const handleTabChange = useCallback(
    (tabId: string) => {
      setSearchParams({ tab: tabId });
    },
    [setSearchParams]
  );

  // Define tabs with proper content
  const tabs = [
    {
      id: 'chat',
      label: 'Chat',
      content: <ChatView />,
    },
    {
      id: 'traces',
      label: 'Traces',
      content: isSessionsLoaded ? (
        <TraceAnalysisView session={currentSession} messages={messages} />
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-[var(--text-secondary)]">Loading...</p>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Tabs - no header for consistency between Chat and Traces */}
      <Tabs
        tabs={tabs}
        defaultTab={activeTab}
        onChange={handleTabChange}
        fillHeight
      />
    </div>
  );
}
