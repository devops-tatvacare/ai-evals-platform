import { useParams, useSearchParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Tabs, Card, Skeleton } from '@/components/ui';
import { ChatView } from '@/features/kaira/components/ChatView';
import { TraceAnalysisView } from '@/features/kaira/components/TraceAnalysisView';
import { TraceExportButton } from '@/features/kaira/components/TraceExportButton';
import { chatSessionsRepository, chatMessagesRepository } from '@/services/storage/chatRepository';
import type { KairaChatSession, KairaChatMessage } from '@/types';

export function KairaBotListingPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [session, setSession] = useState<KairaChatSession | null>(null);
  const [messages, setMessages] = useState<KairaChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load session and messages
  useEffect(() => {
    async function loadData() {
      if (!id) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        const sessionData = await chatSessionsRepository.getById('kaira-bot', id);
        
        if (sessionData) {
          setSession(sessionData);
          const messagesData = await chatMessagesRepository.getBySession(id);
          setMessages(messagesData);
        } else {
          setError('Chat session not found');
        }
      } catch (err) {
        console.error('Failed to load chat session:', err);
        setError('Failed to load chat session');
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [id]);

  // Get active tab from URL or default to 'chat'
  const activeTab = searchParams.get('tab') || 'chat';
  
  const handleTabChange = (tabId: string) => {
    setSearchParams({ tab: tabId });
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <Card className="p-8 text-center m-4">
        <p className="text-[var(--color-error)]">{error || 'Chat session not found'}</p>
      </Card>
    );
  }

  const tabs = [
    {
      id: 'chat',
      label: 'Chat',
      content: <ChatView sessionId={id!} />,
    },
    {
      id: 'trace',
      label: 'Trace Analysis',
      content: <TraceAnalysisView messages={messages} />,
    },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-[var(--border-subtle)] px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">
              {session.title}
            </h1>
            <p className="text-[13px] text-[var(--text-secondary)] mt-1">
              {new Date(session.createdAt).toLocaleString()}
            </p>
          </div>
          
          {/* Export button - only show on trace tab */}
          {activeTab === 'trace' && (
            <TraceExportButton session={session} messages={messages} />
          )}
        </div>
      </div>

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
