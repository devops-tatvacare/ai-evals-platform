/**
 * Chat Store
 * Zustand store for managing Kaira chat state
 */

import { create } from 'zustand';
import type { AppId, KairaChatSession, KairaChatMessage } from '@/types';
import { chatSessionsRepository, chatMessagesRepository } from '@/services/storage';
import { kairaChatService } from '@/services/kaira';
import { generateId } from '@/utils';

interface ChatStoreState {
  // Current session
  currentSessionId: string | null;
  sessions: Record<AppId, KairaChatSession[]>;
  messages: KairaChatMessage[];
  
  // UI state
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
  isLoading: boolean;
  isCreatingSession: boolean;
  isSending: boolean;
  isDeleting: boolean;
  isSessionsLoaded: Record<AppId, boolean>;
  
  // Abort controller for canceling streams
  abortController: AbortController | null;
  
  // Actions
  loadSessions: (appId: AppId) => Promise<void>;
  selectSession: (appId: AppId, sessionId: string | null) => Promise<void>;
  createSession: (appId: AppId, userId: string) => Promise<KairaChatSession>;
  deleteSession: (appId: AppId, sessionId: string) => Promise<void>;
  sendMessage: (appId: AppId, content: string) => Promise<void>;
  sendMessageStreaming: (appId: AppId, content: string) => Promise<void>;
  cancelStream: () => void;
  clearError: () => void;
  updateSessionTitle: (appId: AppId, sessionId: string, title: string) => Promise<void>;
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  currentSessionId: null,
  sessions: {
    'voice-rx': [],
    'kaira-bot': [],
  },
  messages: [],
  isStreaming: false,
  streamingContent: '',
  error: null,
  isLoading: false,
  isCreatingSession: false,
  isSending: false,
  isDeleting: false,
  isSessionsLoaded: {
    'voice-rx': false,
    'kaira-bot': false,
  },
  abortController: null,

  loadSessions: async (appId: AppId) => {
    console.log('[chatStore] loadSessions called for appId:', appId);
    
    // Skip if already loaded
    if (get().isSessionsLoaded[appId]) {
      console.log('[chatStore] Sessions already loaded for', appId);
      return;
    }
    
    try {
      console.log('[chatStore] Setting isLoading: true');
      set({ isLoading: true, error: null });
      
      console.log('[chatStore] Fetching sessions from repository...');
      
      const sessions = await chatSessionsRepository.getAll(appId);
      
      console.log('[chatStore] Fetched sessions:', sessions.length, 'sessions');
      
      set((state) => ({
        sessions: {
          ...state.sessions,
          [appId]: sessions,
        },
        isSessionsLoaded: {
          ...state.isSessionsLoaded,
          [appId]: true,
        },
        isLoading: false,
      }));
      console.log('[chatStore] loadSessions completed successfully');
    } catch (err) {
      console.error('[chatStore] Failed to load chat sessions:', err);
      set((state) => ({ 
        error: 'Failed to load chat sessions', 
        isLoading: false,
        isSessionsLoaded: {
          ...state.isSessionsLoaded,
          [appId]: true,
        },
      }));
    }
  },

  selectSession: async (_appId: AppId, sessionId: string | null) => {
    if (!sessionId) {
      set({ currentSessionId: null, messages: [] });
      return;
    }

    // Clear messages immediately to prevent cross-session contamination
    set({ currentSessionId: sessionId, messages: [], isLoading: true, error: null });

    try {
      const messages = await chatMessagesRepository.getBySession(sessionId);
      set({ 
        messages,
        isLoading: false,
      });
    } catch (err) {
      console.error('Failed to load session messages:', err);
      set({ 
        currentSessionId: null,
        messages: [],
        error: 'Failed to load messages', 
        isLoading: false 
      });
    }
  },

  createSession: async (appId: AppId, userId: string) => {
    console.log('[chatStore] createSession called - appId:', appId, 'userId:', userId);
    
    // Guard against concurrent session creation - check current state, not closure
    const state = get();
    if (state.isCreatingSession) {
      console.log('[chatStore] Session creation already in progress, skipping');
      throw new Error('Session creation already in progress');
    }
    
    console.log('[chatStore] Setting isCreatingSession: true');
    set({ isCreatingSession: true, error: null });
    
    try {
      const threadId = generateId();
      console.log('[chatStore] Generated threadId:', threadId);
      
      console.log('[chatStore] Creating session in repository...');
      const session = await chatSessionsRepository.create(appId, {
        userId,
        threadId,
        title: 'New Chat',
        status: 'active',
        isFirstMessage: true,
      });
      console.log('[chatStore] Session created with id:', session.id);

      set((state) => ({
        sessions: {
          ...state.sessions,
          [appId]: [session, ...(state.sessions[appId] || [])],
        },
        currentSessionId: session.id,
        messages: [],
        isCreatingSession: false,
      }));

      console.log('[chatStore] createSession completed successfully');
      return session;
    } catch (err) {
      console.error('[chatStore] Failed to create session:', err);
      set({ 
        isCreatingSession: false,
        error: err instanceof Error ? err.message : 'Failed to create session',
      });
      throw err;
    }
  },

  deleteSession: async (appId: AppId, sessionId: string) => {
    // Guard against concurrent deletion
    const state = get();
    if (state.isDeleting) {
      throw new Error('Delete already in progress');
    }
    
    set({ isDeleting: true, error: null });
    
    try {
      // DB operation first - only update state on success
      await chatSessionsRepository.delete(appId, sessionId);
      
      set((state) => {
        const newSessions = {
          ...state.sessions,
          [appId]: (state.sessions[appId] || []).filter(s => s.id !== sessionId),
        };
        
        // If we deleted the current session, clear it
        const shouldClearCurrent = state.currentSessionId === sessionId;
        
        return {
          sessions: newSessions,
          currentSessionId: shouldClearCurrent ? null : state.currentSessionId,
          messages: shouldClearCurrent ? [] : state.messages,
          isDeleting: false,
        };
      });
    } catch (err) {
      console.error('Failed to delete session:', err);
      set({ 
        isDeleting: false,
        error: err instanceof Error ? err.message : 'Failed to delete session',
      });
      throw err;
    }
  },

  sendMessage: async (appId: AppId, content: string) => {
    // Guard against concurrent sends - check current state
    const state = get();
    if (state.isSending || state.isStreaming) {
      console.warn('Message send already in progress');
      return;
    }
    
    const { currentSessionId, sessions } = state;
    
    if (!currentSessionId) {
      set({ error: 'No session selected' });
      return;
    }

    const session = sessions[appId]?.find(s => s.id === currentSessionId);
    if (!session) {
      set({ error: 'Session not found' });
      return;
    }

    set({ isSending: true, error: null });

    try {
      // Create user message
      const userMessage = await chatMessagesRepository.create({
        sessionId: currentSessionId,
        role: 'user',
        content,
        timestamp: new Date(),
        status: 'complete',
      });

      // Create pending assistant message
      const assistantMessage = await chatMessagesRepository.create({
        sessionId: currentSessionId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        status: 'pending',
      });

      set((state) => ({
        messages: [...state.messages, userMessage, assistantMessage],
      }));

      // Detect if this is the first message in the session
      const isFirstMessage = session.isFirstMessage ?? false;

      // Send to API
      const response = await kairaChatService.sendMessage({
        query: content,
        userId: session.userId,
        threadId: session.threadId,
        endSession: isFirstMessage,
      });

      // Update assistant message with response
      await chatMessagesRepository.update(assistantMessage.id, {
        content: response.message,
        status: 'complete',
        metadata: {
          intents: response.detected_intents,
          agentResponses: response.agent_responses,
          processingTime: response.processing_time,
          isMultiIntent: response.is_multi_intent,
        },
      });

      // Update session with server session ID if first message
      if (!session.serverSessionId && response.session_id) {
        await chatSessionsRepository.update(appId, currentSessionId, {
          serverSessionId: response.session_id,
        });
        
        // Update local state with serverSessionId
        set((state) => ({
          sessions: {
            ...state.sessions,
            [appId]: state.sessions[appId]?.map(s => 
              s.id === currentSessionId ? { ...s, serverSessionId: response.session_id } : s
            ) || [],
          },
        }));
      }

      // Clear the isFirstMessage flag after first message
      if (isFirstMessage) {
        await chatSessionsRepository.update(appId, currentSessionId, {
          isFirstMessage: false,
        });
        
        // Update local state
        set((state) => ({
          sessions: {
            ...state.sessions,
            [appId]: state.sessions[appId]?.map(s => 
              s.id === currentSessionId ? { ...s, isFirstMessage: false } : s
            ) || [],
          },
        }));
      }

      // Update title if it's still "New Chat"
      if (session.title === 'New Chat') {
        const newTitle = content.slice(0, 50) + (content.length > 50 ? '...' : '');
        await chatSessionsRepository.update(appId, currentSessionId, { title: newTitle });
        
        set((state) => ({
          sessions: {
            ...state.sessions,
            [appId]: state.sessions[appId]?.map(s => 
              s.id === currentSessionId ? { ...s, title: newTitle } : s
            ) || [],
          },
        }));
      }

      // Update messages in state
      set((state) => ({
        messages: state.messages.map(m => 
          m.id === assistantMessage.id 
            ? { 
                ...m, 
                content: response.message, 
                status: 'complete' as const,
                metadata: {
                  intents: response.detected_intents,
                  agentResponses: response.agent_responses,
                  processingTime: response.processing_time,
                  isMultiIntent: response.is_multi_intent,
                },
              } 
            : m
        ),
        isSending: false,
      }));

    } catch (err) {
      console.error('Failed to send message:', err);
      
      set((state) => ({
        messages: state.messages.map(m => 
          m.status === 'pending'
            ? { 
                ...m, 
                status: 'error' as const, 
                errorMessage: err instanceof Error ? err.message : 'Failed to get response',
              } 
            : m
        ),
        error: err instanceof Error ? err.message : 'Failed to send message',
        isSending: false,
      }));
    }
  },

  sendMessageStreaming: async (appId: AppId, content: string) => {
    // Guard against concurrent sends - check current state
    const state = get();
    if (state.isSending || state.isStreaming) {
      console.warn('Message send already in progress');
      return;
    }
    
    const { currentSessionId, sessions } = state;
    
    if (!currentSessionId) {
      set({ error: 'No session selected' });
      return;
    }

    const session = sessions[appId]?.find(s => s.id === currentSessionId);
    if (!session) {
      set({ error: 'Session not found' });
      return;
    }

    // Create abort controller
    const abortController = new AbortController();

    // Create user message
    const userMessage = await chatMessagesRepository.create({
      sessionId: currentSessionId,
      role: 'user',
      content,
      timestamp: new Date(),
      status: 'complete',
    });

    // Create streaming assistant message
    const assistantMessage = await chatMessagesRepository.create({
      sessionId: currentSessionId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      status: 'streaming',
    });

    set((state) => ({
      messages: [...state.messages, userMessage, assistantMessage],
      isStreaming: true,
      streamingContent: '',
      error: null,
      abortController,
    }));

    try {
      let fullContent = '';
      const metadata: KairaChatMessage['metadata'] = {};

      // Detect if this is the first message in the session
      const isFirstMessage = session.isFirstMessage ?? false;

      for await (const chunk of kairaChatService.streamMessage(
        {
          query: content,
          userId: session.userId,
          threadId: session.threadId,
          endSession: isFirstMessage,
        },
        abortController.signal
      )) {
        // Process different chunk types
        switch (chunk.type) {
          case 'session_context':
            if (!session.serverSessionId && chunk.session_id) {
              await chatSessionsRepository.update(appId, currentSessionId, {
                serverSessionId: chunk.session_id,
              });
              
              // Update local state with serverSessionId
              set((state) => ({
                sessions: {
                  ...state.sessions,
                  [appId]: state.sessions[appId]?.map(s => 
                    s.id === currentSessionId ? { ...s, serverSessionId: chunk.session_id } : s
                  ) || [],
                },
              }));
            }
            
            // Clear the isFirstMessage flag after first message
            if (isFirstMessage) {
              await chatSessionsRepository.update(appId, currentSessionId, {
                isFirstMessage: false,
              });
              
              // Update local state
              set((state) => ({
                sessions: {
                  ...state.sessions,
                  [appId]: state.sessions[appId]?.map(s => 
                    s.id === currentSessionId ? { ...s, isFirstMessage: false } : s
                  ) || [],
                },
              }));
            }
            
            metadata.responseId = chunk.response_id;
            break;

          case 'intent_classification':
            metadata.intents = chunk.detected_intents;
            metadata.isMultiIntent = chunk.is_multi_intent;
            break;

          case 'agent_response':
            // Accumulate agent responses
            if (!metadata.agentResponses) {
              metadata.agentResponses = [];
            }
            metadata.agentResponses.push({
              agent: chunk.agent,
              message: chunk.message,
              success: chunk.success,
              data: chunk.data,
            });
            break;

          case 'summary':
            fullContent = chunk.message;
            set({ streamingContent: fullContent });
            break;

          case 'error':
            throw new Error(chunk.error);
        }
      }

      // Update assistant message with final content
      await chatMessagesRepository.update(assistantMessage.id, {
        content: fullContent,
        status: 'complete',
        metadata,
      });

      // Update title if it's still "New Chat"
      if (session.title === 'New Chat') {
        const newTitle = content.slice(0, 50) + (content.length > 50 ? '...' : '');
        await chatSessionsRepository.update(appId, currentSessionId, { title: newTitle });
        
        set((state) => ({
          sessions: {
            ...state.sessions,
            [appId]: state.sessions[appId]?.map(s => 
              s.id === currentSessionId ? { ...s, title: newTitle } : s
            ) || [],
          },
        }));
      }

      set((state) => ({
        messages: state.messages.map(m => 
          m.id === assistantMessage.id 
            ? { ...m, content: fullContent, status: 'complete' as const, metadata } 
            : m
        ),
        isStreaming: false,
        streamingContent: '',
        abortController: null,
      }));

    } catch (err) {
      console.error('Streaming error:', err);
      
      await chatMessagesRepository.update(assistantMessage.id, {
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Streaming failed',
      });

      set((state) => ({
        messages: state.messages.map(m => 
          m.id === assistantMessage.id 
            ? { 
                ...m, 
                status: 'error' as const, 
                errorMessage: err instanceof Error ? err.message : 'Streaming failed',
              } 
            : m
        ),
        isStreaming: false,
        streamingContent: '',
        error: err instanceof Error ? err.message : 'Streaming failed',
        abortController: null,
      }));
    }
  },

  cancelStream: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
      set({ 
        isStreaming: false, 
        streamingContent: '',
        abortController: null,
      });
    }
  },

  clearError: () => {
    set({ error: null });
  },

  updateSessionTitle: async (appId: AppId, sessionId: string, title: string) => {
    await chatSessionsRepository.update(appId, sessionId, { title });
    
    set((state) => ({
      sessions: {
        ...state.sessions,
        [appId]: state.sessions[appId]?.map(s => 
          s.id === sessionId ? { ...s, title } : s
        ) || [],
      },
    }));
  },
}));
