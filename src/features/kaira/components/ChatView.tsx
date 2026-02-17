/**
 * Chat View Component
 * Main orchestrator for the Kaira chat interface
 */

import React, { useCallback, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import { Spinner, Alert, EmptyState, DebugFab } from '@/components/ui';
import { useKairaChat } from '@/hooks';
import { useKairaBotSettings } from '@/stores';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import { SuggestedPrompts } from './SuggestedPrompts';
import { UserIdInput } from './UserIdInput';

interface ChatViewProps {
  /** Optional session ID - if provided, loads and displays this specific session */
  sessionId?: string;
}

export function ChatView({ sessionId }: ChatViewProps = {}) {
  const {
    sessions,
    currentSession,
    messages,
    isLoading,
    isStreaming,
    isCreatingSession,
    isSending,
    isSessionsLoaded,
    streamingContent,
    error,
    selectSession,
    createSession,
    sendMessageStreaming,
    cancelStream,
    clearError,
    updateMessageMetadata,
  } = useKairaChat();

  const { settings, updateSettings } = useKairaBotSettings();

  // Get stored userId from settings
  const userId = settings.kairaChatUserId;

  // Handle user ID submission
  const handleUserIdSubmit = useCallback(async (newUserId: string) => {
    await updateSettings({ kairaChatUserId: newUserId });
  }, [updateSettings]);

  // Handle creating a new chat session
  const handleNewChat = useCallback(async () => {
    if (!userId || isCreatingSession || isStreaming) return;

    try {
      const session = await createSession(userId);
      await selectSession(session.id);
    } catch (err) {
      // Session creation failed (likely concurrent creation guard)
      console.warn('Session creation skipped:', err);
    }
  }, [userId, isCreatingSession, isStreaming, createSession, selectSession]);

  // Handle sending a message (using streaming)
  const handleSendMessage = useCallback(async (content: string) => {
    await sendMessageStreaming(content);
  }, [sendMessageStreaming]);

  // Handle action chip clicks - send the full chip label as a message
  // Must include emoji prefix (e.g. "✅ Yes, log this meal") — the server
  // uses it to distinguish confirmation actions from regular text queries
  const handleChipClick = useCallback(async (_chipId: string, chipLabel: string) => {
    await sendMessageStreaming(chipLabel);
  }, [sendMessageStreaming]);

  // Handle suggested prompt selection
  const handleSuggestedPrompt = useCallback(async (prompt: string) => {
    await sendMessageStreaming(prompt);
  }, [sendMessageStreaming]);

  // Auto-create session on first load if user has userId but no sessions
  // Use ref to track if we've already triggered auto-create to prevent race conditions
  const hasAutoCreatedRef = React.useRef(false);

  useEffect(() => {
    // Reset the flag when sessions are loaded with existing sessions
    if (isSessionsLoaded && sessions.length > 0) {
      hasAutoCreatedRef.current = true;
    }
  }, [isSessionsLoaded, sessions.length]);

  useEffect(() => {
    const shouldAutoCreate =
      userId &&
      isSessionsLoaded &&
      sessions.length === 0 &&
      !currentSession &&
      !isCreatingSession &&
      !hasAutoCreatedRef.current;

    console.log('[ChatView] Auto-create check:', {
      userId: !!userId,
      isSessionsLoaded,
      sessionsLength: sessions.length,
      currentSession: !!currentSession,
      isCreatingSession,
      hasAutoCreated: hasAutoCreatedRef.current,
      shouldAutoCreate,
    });

    if (shouldAutoCreate) {
      console.log('[ChatView] Auto-creating session for userId:', userId);
      hasAutoCreatedRef.current = true;
      // Inline the createSession call to avoid stale closure issues
      createSession(userId).then(session => {
        console.log('[ChatView] Auto-created session:', session.id);
        selectSession(session.id);
      }).catch(err => {
        // Session creation failed (likely concurrent creation guard)
        console.warn('[ChatView] Auto-create session skipped:', err);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- createSession and selectSession are stable store actions
  }, [userId, isSessionsLoaded, sessions.length, currentSession, isCreatingSession]);

  // When sessionId prop is provided, select that specific session
  useEffect(() => {
    if (sessionId && isSessionsLoaded) {
      selectSession(sessionId);
    }
  }, [sessionId, isSessionsLoaded, selectSession]);

  // Auto-select first session if none selected (only when no sessionId prop)
  useEffect(() => {
    if (!sessionId && userId && isSessionsLoaded && sessions.length > 0 && !currentSession && !isLoading) {
      selectSession(sessions[0].id);
    }
  }, [sessionId, userId, isSessionsLoaded, sessions, currentSession, isLoading, selectSession]);

  // If no user ID is set, show the user ID input
  if (!userId) {
    console.log('[ChatView] No userId, showing input');
    return <UserIdInput onSubmit={handleUserIdSubmit} />;
  }

  console.log('[ChatView] Render state:', {
    userId,
    isSessionsLoaded,
    isLoading,
    sessionsCount: sessions.length,
    currentSession: currentSession?.id,
    messagesCount: messages.length,
    isCreatingSession,
  });

  // Show loading state while sessions are loading initially
  if (!isSessionsLoaded || (isLoading && messages.length === 0 && !currentSession)) {
    console.log('[ChatView] Showing loading spinner - isSessionsLoaded:', isSessionsLoaded, 'isLoading:', isLoading);
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  // No current session - show empty state with new chat button
  if (!currentSession) {
    console.log('[ChatView] No current session, showing empty state');
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={MessageSquare}
          title="No Chat Selected"
          description="Select a chat from the sidebar or start a new one"
          className="w-full max-w-md"
          action={{
            label: 'New Chat',
            onClick: handleNewChat,
            isLoading: isCreatingSession,
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Error banner */}
      {error && (
        <div className="px-4 pt-2">
          <Alert variant="error" onDismiss={clearError}>
            {error}
          </Alert>
        </div>
      )}

      {/* Messages or empty state with suggested prompts */}
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
          <EmptyState
            icon={MessageSquare}
            title="Start a conversation"
            description="Ask Kaira about health, nutrition, or anything"
            className="w-full max-w-md"
          />
          <SuggestedPrompts onSelect={handleSuggestedPrompt} />
        </div>
      ) : (
        <ChatMessageList
          messages={messages}
          isStreaming={isStreaming}
          streamingContent={streamingContent}
          onChipClick={handleChipClick}
          updateMessageMetadata={updateMessageMetadata}
        />
      )}

      {/* Input area with debug FAB above */}
      <div className="relative shrink-0">
        <DebugFab
          className="absolute -top-12 right-3"
          sections={[
            {
              title: 'Session',
              items: [
                { label: 'Local ID', value: currentSession?.id },
                { label: 'Thread ID', value: currentSession?.threadId },
                { label: 'Server Session', value: currentSession?.serverSessionId },
                { label: 'User ID', value: currentSession?.userId },
                { label: 'Status', value: currentSession?.status, copyable: false },
              ],
            },
            ...((() => {
              const lastMsg = messages.filter(m => m.role === 'assistant' && m.status === 'complete').pop();
              const meta = lastMsg?.metadata;
              if (!meta) return [];
              return [{
                title: 'Last Response',
                items: [
                  { label: 'Response ID', value: meta.responseId },
                  { label: 'Processing Time', value: meta.processingTime ? `${meta.processingTime.toFixed(2)}s` : undefined, copyable: false },
                  { label: 'Multi-Intent', value: meta.isMultiIntent !== undefined ? String(meta.isMultiIntent) : undefined, copyable: false },
                  { label: 'Agents', value: meta.intents?.map(i => i.agent).join(', '), copyable: false },
                ],
              }];
            })()),
          ]}
        />
        <ChatInput
          onSend={handleSendMessage}
          onCancel={cancelStream}
          disabled={isLoading || isSending}
          isStreaming={isStreaming}
          placeholder="Ask Kaira anything about health..."
        />
      </div>
    </div>
  );
}
