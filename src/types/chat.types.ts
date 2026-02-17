/**
 * Chat Types for Kaira Bot
 * Types for chat sessions, messages, and API responses
 */

import type { AppId } from './app.types';

// ============================================================================
// Database Entity Types
// ============================================================================

export interface KairaChatSession {
  id: string;                    // Local UUID
  appId: AppId;                  // Always 'kaira-bot'
  userId: string;                // Kaira API user_id
  threadId?: string;             // Kaira API thread_id (from server on first response)
  serverSessionId?: string;      // From API session_id response (from server on first response)
  lastResponseId?: string;       // Last response_id from API (needed for conversation continuity)
  title: string;                 // First message or auto-generated
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'ended';
  isFirstMessage?: boolean;      // Track if first message hasn't been sent yet
}

export interface KairaChatMessage {
  id: string;
  sessionId: string;             // FK to KairaChatSession.id
  role: 'user' | 'assistant';
  content: string;
  metadata?: ChatMessageMetadata;
  createdAt: Date;
  status: 'pending' | 'streaming' | 'complete' | 'error';
  errorMessage?: string;
}

export interface ChatMessageMetadata {
  intents?: Array<{ agent: string; confidence: number }>;
  agentResponses?: Array<{ agent: string; message: string; success: boolean; data?: unknown }>;
  processingTime?: number;
  responseId?: string;
  isMultiIntent?: boolean;
  // Debug data: raw API request/response
  apiRequest?: KairaChatRequest;
  apiResponse?: KairaChatResponse;
  // User tags for message annotation
  tags?: string[];
  // Action buttons state
  actionsDisabled?: boolean;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface KairaChatRequest {
  query: string;
  user_id: string;
  thread_id?: string;            // Only sent after first response
  session_id?: string;           // Only sent after first response
  context?: Record<string, unknown>;
  end_session?: boolean;
}

export interface KairaChatResponse {
  success: boolean;
  message: string;
  original_query: string;
  detected_intents: Array<{ agent: string; confidence: number }>;
  agent_responses: Array<{
    agent: string;
    message: string;
    success: boolean;
    data?: unknown;
  }>;
  is_multi_intent: boolean;
  processing_time: number;
  user_id: string;
  thread_id: string;
  session_id: string;
}

// ============================================================================
// Streaming Types
// ============================================================================

export type KairaStreamChunkType =
  | 'stream_start'
  | 'session_context'
  | 'session_end'
  | 'session_start'
  | 'intent_classification'
  | 'agent_response'
  | 'summary'
  | 'error';

export interface KairaStreamChunkBase {
  type: KairaStreamChunkType;
  timestamp?: number;
}

export interface StreamStartChunk extends KairaStreamChunkBase {
  type: 'stream_start';
  thread_id: string;
}

export interface SessionContextChunk extends KairaStreamChunkBase {
  type: 'session_context';
  thread_id: string;
  session_id: string;
  response_id: string;
}

export interface IntentClassificationChunk extends KairaStreamChunkBase {
  type: 'intent_classification';
  detected_intents: Array<{ agent: string; confidence: number }>;
  is_multi_intent: boolean;
}

export interface AgentResponseChunk extends KairaStreamChunkBase {
  type: 'agent_response';
  agent: string;
  message: string;
  success: boolean;
  data?: unknown;
  thread_id?: string;
  response_id?: string;
  session_active?: boolean;
}

export interface SummaryChunk extends KairaStreamChunkBase {
  type: 'summary';
  message: string;
  agent_count: number;
}

export interface ErrorChunk extends KairaStreamChunkBase {
  type: 'error';
  error: string;
}

export interface SessionEndChunk extends KairaStreamChunkBase {
  type: 'session_end';
  success: boolean;
  message: string;
  user_id: string;
  thread_id: string;
}

export interface SessionStartChunk extends KairaStreamChunkBase {
  type: 'session_start';
  agent: string;
  success: boolean;
  message: string;
  thread_id: string;
}

export type KairaStreamChunk =
  | StreamStartChunk
  | SessionContextChunk
  | IntentClassificationChunk
  | AgentResponseChunk
  | SummaryChunk
  | ErrorChunk
  | SessionEndChunk
  | SessionStartChunk;

// ============================================================================
// Store Types
// ============================================================================

export interface ChatStoreState {
  // Current session
  currentSessionId: string | null;
  sessions: Record<AppId, KairaChatSession[]>;
  messages: KairaChatMessage[];

  // UI state
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
  isLoading: boolean;
}
