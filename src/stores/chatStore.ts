/**
 * Chat Store
 * Zustand store for managing Kaira chat state
 */

import { create } from 'zustand';
import type { AppId, KairaChatSession, KairaChatMessage } from '@/types';
import { chatSessionsRepository, chatMessagesRepository } from '@/services/storage';
import { kairaChatService } from '@/services/kaira';

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
  updateMessageMetadata: (messageId: string, metadata: Partial<KairaChatMessage['metadata']>) => Promise<void>;
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
      // Don't generate threadId - server will provide it on first message
      console.log('[chatStore] Creating session in repository (no threadId yet)...');
      const session = await chatSessionsRepository.create(appId, {
        userId,
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
      // First message: only query, userId, context, end_session: true
      // Subsequent: query, userId, threadId, sessionId, context, end_session: false
      const apiRequest = {
        query: content,
        userId: session.userId,
        ...(!isFirstMessage && { 
          threadId: session.threadId,
          sessionId: session.serverSessionId,
        }),
        context: { additionalProp1: {} },
        endSession: isFirstMessage,
      };
      
      const response = await kairaChatService.sendMessage(apiRequest);

      // Update assistant message with response
      await chatMessagesRepository.update(assistantMessage.id, {
        content: response.message,
        status: 'complete',
        metadata: {
          intents: response.detected_intents,
          agentResponses: response.agent_responses,
          processingTime: response.processing_time,
          isMultiIntent: response.is_multi_intent,
          apiRequest: {
            query: apiRequest.query,
            user_id: apiRequest.userId,
            ...(apiRequest.threadId && { thread_id: apiRequest.threadId }),
            ...(apiRequest.sessionId && { session_id: apiRequest.sessionId }),
            ...(apiRequest.endSession !== undefined && { end_session: apiRequest.endSession }),
          },
          apiResponse: response,
        },
      });

      // Capture session_id and thread_id from first response
      if (isFirstMessage && response.session_id && response.thread_id) {
        await chatSessionsRepository.update(appId, currentSessionId, {
          serverSessionId: response.session_id,
          threadId: response.thread_id,
          isFirstMessage: false,
        });
        
        // Update local state with both IDs
        set((state) => ({
          sessions: {
            ...state.sessions,
            [appId]: state.sessions[appId]?.map(s => 
              s.id === currentSessionId ? { 
                ...s, 
                serverSessionId: response.session_id,
                threadId: response.thread_id,
                isFirstMessage: false 
              } : s
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
                  apiRequest: {
                    query: apiRequest.query,
                    user_id: apiRequest.userId,
                    ...(apiRequest.threadId && { thread_id: apiRequest.threadId }),
                    ...(apiRequest.sessionId && { session_id: apiRequest.sessionId }),
                    ...(apiRequest.endSession !== undefined && { end_session: apiRequest.endSession }),
                  },
                  apiResponse: response,
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
      const streamStartTime = Date.now();
      let streamThreadId: string | undefined;
      let streamSessionId: string | undefined;

      // Detect if this is the first message in the session
      const isFirstMessage = session.isFirstMessage ?? false;

      // Prepare API request with proper field order
      // First message: query, user_id, session_id (same as user_id), context, stream: false, end_session: true
      // Later messages: query, user_id, session_id, context, stream: false, thread_id, end_session: false
      const apiRequest = isFirstMessage ? {
        query: content,
        user_id: session.userId,
        session_id: session.userId, // Same as user_id for first message
        context: {
          additionalProp1: {},
        },
        stream: false,
        end_session: true,
      } : {
        query: content,
        user_id: session.userId,
        session_id: session.serverSessionId || session.userId,
        context: {
          additionalProp1: {},
        },
        stream: false,
        thread_id: session.threadId,
        end_session: false,
      };
      
      // Capture API request for debugging
      metadata.apiRequest = apiRequest;
      
      for await (const chunk of kairaChatService.streamMessage(
        apiRequest,
        abortController.signal
      )) {
        console.log('[ChatStore] Received chunk:', chunk.type, chunk);
        
        // Process different chunk types
        switch (chunk.type) {
          case 'session_context':
            // Capture session_id, thread_id, and response_id from response
            streamThreadId = chunk.thread_id;
            streamSessionId = chunk.session_id;
            
            // Always update response_id for every response (needed for next message)
            await chatSessionsRepository.update(appId, currentSessionId, {
              lastResponseId: chunk.response_id,
              ...(isFirstMessage && chunk.session_id && chunk.thread_id ? {
                serverSessionId: chunk.session_id,
                threadId: chunk.thread_id,
                isFirstMessage: false,
              } : {}),
            });
            
            // Update local state
            set((state) => ({
              sessions: {
                ...state.sessions,
                [appId]: state.sessions[appId]?.map(s => 
                  s.id === currentSessionId ? { 
                    ...s,
                    lastResponseId: chunk.response_id,
                    ...(isFirstMessage && chunk.session_id && chunk.thread_id ? {
                      serverSessionId: chunk.session_id,
                      threadId: chunk.thread_id,
                      isFirstMessage: false,
                    } : {}),
                  } : s
                ) || [],
              },
            }));
            
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
            
            // Update streaming content with agent response message
            // This allows UI to show responses as they come in
            if (chunk.success && chunk.message) {
              fullContent = chunk.message;
              set({ streamingContent: fullContent });
            }
            break;

          case 'summary':
            // Final summary message (for multi-intent queries)
            fullContent = chunk.message;
            set({ streamingContent: fullContent });
            break;

          case 'session_end':
            // Session was ended (happens when end_session: true)
            // Just log it, we don't need to do anything special
            console.log('[ChatStore] Session ended:', chunk.message);
            break;

          case 'error':
            throw new Error(chunk.error);
        }
      }

      console.log('[ChatStore] Stream complete. Final content:', fullContent);
      // Calculate processing time
      metadata.processingTime = (Date.now() - streamStartTime) / 1000;
      
      // Reconstruct API response from streaming chunks for debugging
      metadata.apiResponse = {
        success: true,
        message: fullContent,
        original_query: content,
        detected_intents: metadata.intents || [],
        agent_responses: metadata.agentResponses || [],
        is_multi_intent: metadata.isMultiIntent || false,
        processing_time: metadata.processingTime,
        user_id: session.userId,
        thread_id: streamThreadId || session.threadId || '',
        session_id: streamSessionId || session.serverSessionId || '',
      };

      // Update assistant message with final content
      console.log('[ChatStore] Updating assistant message with content:', fullContent.substring(0, 50));
      await chatMessagesRepository.update(assistantMessage.id, {
        content: fullContent,
        status: 'complete',
        metadata,
      });
      console.log('[ChatStore] Assistant message updated successfully');

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
      
      console.log('[ChatStore] State updated with final message');

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

  updateMessageMetadata: async (messageId: string, metadataUpdates: Partial<KairaChatMessage['metadata']>) => {
    // Find the message to get current metadata
    const currentMessage = get().messages.find(m => m.id === messageId);
    if (!currentMessage) {
      throw new Error(`Message ${messageId} not found`);
    }

    const updatedMetadata = {
      ...currentMessage.metadata,
      ...metadataUpdates,
    };

    // Update in database
    await chatMessagesRepository.update(messageId, {
      metadata: updatedMetadata,
    });

    // Update in store
    set((state) => ({
      messages: state.messages.map(m =>
        m.id === messageId
          ? { ...m, metadata: updatedMetadata }
          : m
      ),
    }));
  },
}));
