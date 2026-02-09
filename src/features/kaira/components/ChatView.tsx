/**
 * Chat View Component
 * Main orchestrator for the Kaira chat interface
 */

import React, { useCallback, useEffect } from 'react';
import { MessageSquare, Plus } from 'lucide-react';
import { Button, Spinner } from '@/components/ui';
import { useKairaChat } from '@/hooks';
import { useKairaBotSettings } from '@/stores';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import { UserIdInput } from './UserIdInput';
import { DebugMetadataPanel } from './DebugMetadataPanel';

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

  // Handle action chip clicks - send the chip label as a message
  const handleChipClick = useCallback(async (_chipId: string, chipLabel: string) => {
    // Remove emoji and trim the label for cleaner message
    const cleanLabel = chipLabel.replace(/^[\p{Emoji}\s]+/u, '').trim();
    await sendMessageStreaming(cleanLabel || chipLabel);
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
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--color-brand-accent)]/10">
          <MessageSquare className="h-10 w-10 text-[var(--text-brand)]" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            No Chat Selected
          </h2>
          <p className="mt-2 text-[14px] text-[var(--text-secondary)]">
            Select a chat from the sidebar or start a new one
          </p>
        </div>
        <Button
          variant="primary"
          onClick={handleNewChat}
          isLoading={isCreatingSession}
          disabled={isCreatingSession || isStreaming}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Error banner */}
      {error && (
        <div className="bg-[var(--color-error)]/10 border-b border-[var(--color-error)]/20 px-4 py-2 flex items-center justify-between">
          <span className="text-[13px] text-[var(--color-error)]">{error}</span>
          <button 
            onClick={clearError}
            className="text-[12px] text-[var(--color-error)] hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Messages */}
      <ChatMessageList
        messages={messages}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
        onChipClick={handleChipClick}
        updateMessageMetadata={updateMessageMetadata}
      />

      {/* Debug Metadata Panel (dev mode only) */}
      <DebugMetadataPanel 
        session={currentSession}
        lastAssistantMessage={messages.filter(m => m.role === 'assistant' && m.status === 'complete').pop()}
      />

      {/* Input */}
      <ChatInput
        onSend={handleSendMessage}
        onCancel={cancelStream}
        disabled={isLoading || isSending}
        isStreaming={isStreaming}
        placeholder="Ask Kaira anything about health..."
      />
    </div>
  );
}
