/**
 * useKairaChat Hook
 * Context-aware hook for Kaira chat functionality
 */

import { useEffect, useCallback } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useCurrentAppId } from './useCurrentAppData';
import type { KairaChatSession, KairaChatMessage } from '@/types';

export interface UseKairaChatReturn {
  // Data
  sessions: KairaChatSession[];
  currentSession: KairaChatSession | null;
  messages: KairaChatMessage[];
  
  // UI State
  isLoading: boolean;
  isStreaming: boolean;
  isCreatingSession: boolean;
  isSending: boolean;
  isDeleting: boolean;
  isSessionsLoaded: boolean;
  streamingContent: string;
  error: string | null;
  
  // Actions
  loadSessions: () => Promise<void>;
  selectSession: (sessionId: string | null) => Promise<void>;
  createSession: (userId: string) => Promise<KairaChatSession>;
  deleteSession: (sessionId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  sendMessageStreaming: (content: string) => Promise<void>;
  cancelStream: () => void;
  clearError: () => void;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;
  updateMessageMetadata: (messageId: string, metadata: Partial<KairaChatMessage['metadata']>) => Promise<void>;
}

export function useKairaChat(): UseKairaChatReturn {
  const appId = useCurrentAppId();
  
  const {
    currentSessionId,
    sessions,
    messages,
    isStreaming,
    streamingContent,
    error,
    isLoading,
    isCreatingSession,
    isSending,
    isDeleting,
    isSessionsLoaded,
    loadSessions: storeLoadSessions,
    selectSession: storeSelectSession,
    createSession: storeCreateSession,
    deleteSession: storeDeleteSession,
    sendMessage: storeSendMessage,
    sendMessageStreaming: storeSendMessageStreaming,
    cancelStream,
    clearError,
    updateSessionTitle: storeUpdateSessionTitle,
    updateMessageMetadata: storeUpdateMessageMetadata,
  } = useChatStore();

  // Auto-load sessions on mount
  useEffect(() => {
    console.log('[useKairaChat] Effect triggered - appId:', appId);
    if (appId === 'kaira-bot') {
      console.log('[useKairaChat] Calling loadSessions for kaira-bot');
      storeLoadSessions(appId);
    }
  }, [appId, storeLoadSessions]);

  // Get current app's sessions
  const appSessions = sessions[appId] ?? [];
  
  // Find current session
  const currentSession = currentSessionId 
    ? appSessions.find(s => s.id === currentSessionId) ?? null 
    : null;

  // Wrap actions to inject appId
  const loadSessions = useCallback(() => {
    return storeLoadSessions(appId);
  }, [appId, storeLoadSessions]);

  const selectSession = useCallback((sessionId: string | null) => {
    return storeSelectSession(appId, sessionId);
  }, [appId, storeSelectSession]);

  const createSession = useCallback((userId: string) => {
    return storeCreateSession(appId, userId);
  }, [appId, storeCreateSession]);

  const deleteSession = useCallback((sessionId: string) => {
    return storeDeleteSession(appId, sessionId);
  }, [appId, storeDeleteSession]);

  const sendMessage = useCallback((content: string) => {
    return storeSendMessage(appId, content);
  }, [appId, storeSendMessage]);

  const sendMessageStreaming = useCallback((content: string) => {
    return storeSendMessageStreaming(appId, content);
  }, [appId, storeSendMessageStreaming]);

  const updateSessionTitle = useCallback((sessionId: string, title: string) => {
    return storeUpdateSessionTitle(appId, sessionId, title);
  }, [appId, storeUpdateSessionTitle]);

  const updateMessageMetadata = useCallback((messageId: string, metadata: Partial<KairaChatMessage['metadata']>) => {
    return storeUpdateMessageMetadata(messageId, metadata);
  }, [storeUpdateMessageMetadata]);

  return {
    sessions: appSessions,
    currentSession,
    messages,
    isLoading,
    isStreaming,
    isCreatingSession,
    isSending,
    isDeleting,
    isSessionsLoaded: isSessionsLoaded[appId] ?? false,
    streamingContent,
    error,
    loadSessions,
    selectSession,
    createSession,
    deleteSession,
    sendMessage,
    sendMessageStreaming,
    cancelStream,
    clearError,
    updateSessionTitle,
    updateMessageMetadata,
  };
}
