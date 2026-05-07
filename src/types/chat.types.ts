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
  tenantId: string;              // Owning tenant UUID
  userId: string;                // Kaira API user_id
  serverSessionId?: string;      // Kaira session_id (from classification chunk on first turn)
  title: string;                 // First message or auto-generated
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'ended';
  newSession?: boolean;          // True until first classification chunk is received
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

export interface FoodCardItem {
  name: string;
  qty: string;
  meal: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

export interface ChatMessageMetadata {
  /** intent + confidence from the classification chunk */
  classification?: { intent: string; agent: string; confidence: number; source: 'text' | 'vision' };
  processingTime?: number;
  /** Structured food card data (food logging turns only) */
  foodCard?: { items: FoodCardItem[]; consumed_at: string; consumed_label: string };
  // Debug data: raw API request
  apiRequest?: KairaChatRequest;
  // User tags for message annotation
  tags?: string[];
  // Action buttons state
  actionsDisabled?: boolean;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface KairaChatRequest {
  message: string;
  user_id: string;
  new_session: boolean;
  session_id?: string;   // omit on first turn
  image_id?: string;
  timezone?: string;
}

// ============================================================================
// Streaming Types
// ============================================================================

export interface ClassificationChunk {
  type: 'classification';
  intent: string;
  agent: string;
  confidence: number;
  source: 'text' | 'vision';
  session_id: string;
}

export interface TokenChunk {
  type: 'token';
  content: string;
}

export interface DoneChunk {
  type: 'done';
  full_response: string;
}

export interface FoodCardChunk {
  type: 'food_card';
  data: { items: FoodCardItem[]; consumed_at: string; consumed_label: string };
}

export interface ErrorChunk {
  type: 'error';
  detail: string;
}

export type KairaStreamChunk =
  | ClassificationChunk
  | TokenChunk
  | DoneChunk
  | FoodCardChunk
  | ErrorChunk;

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
