/**
 * Kaira Bot Tab View
 * Main view with Chat and Trace Analysis tabs (similar to Voice Rx pattern)
 */

import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';
import { Tabs } from '@/components/ui';
import { ChatView } from '@/features/kaira/components/ChatView';
import { TraceAnalysisView, TraceExportButton } from '@/features/kaira/components';
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
        <TraceAnalysisView messages={messages} />
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-[var(--text-secondary)]">Loading...</p>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header with session title and export button */}
      {currentSession && activeTab === 'traces' && (
        <div className="border-b border-[var(--border-subtle)] px-6 py-4 shrink-0 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">
              {currentSession.title}
            </h1>
            <p className="text-[13px] text-[var(--text-secondary)] mt-1">
              {new Date(currentSession.createdAt).toLocaleString()}
            </p>
          </div>
          <TraceExportButton session={currentSession} messages={messages} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex-1 min-h-0">
        <Tabs
          tabs={tabs}
          defaultTab={activeTab}
          onChange={handleTabChange}
          fillHeight
        />
      </div>
    </div>
  );
}
