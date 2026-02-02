/**
 * Chat Repository
 * Database operations for Kaira chat sessions and messages
 */

import { db, waitForDb, isDbAvailable } from './db';
import type { AppId, KairaChatSession, KairaChatMessage } from '@/types';
import { generateId } from '@/utils';

export const chatSessionsRepository = {
  /**
   * Get all chat sessions for a specific app
   */
  async getAll(appId: AppId): Promise<KairaChatSession[]> {
    console.log('[chatSessionsRepository] getAll called for appId:', appId);
    
    // Wait for DB initialization
    const dbReady = await waitForDb();
    if (!dbReady) {
      console.warn('[chatSessionsRepository] Database not available, returning empty array');
      return [];
    }
    
    try {
      console.log('[chatSessionsRepository] Querying IndexedDB...');
      const result = await db.kairaChatSessions
        .where('appId')
        .equals(appId)
        .reverse()
        .sortBy('updatedAt');
      console.log('[chatSessionsRepository] Query completed, found', result.length, 'sessions');
      return result;
    } catch (err) {
      console.error('[chatSessionsRepository] getAll failed:', err);
      return [];
    }
  },

  /**
   * Get a session by ID
   */
  async getById(appId: AppId, id: string): Promise<KairaChatSession | undefined> {
    const session = await db.kairaChatSessions.get(id);
    if (session && session.appId !== appId) {
      console.warn(`Session ${id} belongs to ${session.appId}, not ${appId}`);
      return undefined;
    }
    return session;
  },

  /**
   * Get sessions by user ID
   */
  async getByUserId(appId: AppId, userId: string): Promise<KairaChatSession[]> {
    return db.kairaChatSessions
      .where('appId')
      .equals(appId)
      .filter(session => session.userId === userId)
      .reverse()
      .sortBy('updatedAt');
  },

  /**
   * Create a new chat session
   */
  async create(
    appId: AppId,
    session: Omit<KairaChatSession, 'id' | 'appId' | 'createdAt' | 'updatedAt'>
  ): Promise<KairaChatSession> {
    const now = new Date();
    const newSession: KairaChatSession = {
      ...session,
      id: generateId(),
      appId,
      createdAt: now,
      updatedAt: now,
    };
    
    // Only persist if DB is available
    if (isDbAvailable()) {
      try {
        await db.kairaChatSessions.add(newSession);
      } catch (err) {
        console.error('[chatSessionsRepository] Failed to persist session:', err);
        // Continue anyway - session will work in memory
      }
    } else {
      console.warn('[chatSessionsRepository] DB not available, session will not be persisted');
    }
    
    return newSession;
  },

  /**
   * Update a session
   */
  async update(
    appId: AppId,
    id: string,
    updates: Partial<Omit<KairaChatSession, 'id' | 'appId' | 'createdAt'>>
  ): Promise<void> {
    const existing = await db.kairaChatSessions.get(id);
    if (!existing) {
      throw new Error(`Session ${id} not found`);
    }
    if (existing.appId !== appId) {
      throw new Error(`Session ${id} belongs to ${existing.appId}, not ${appId}`);
    }
    await db.kairaChatSessions.update(id, {
      ...updates,
      updatedAt: new Date(),
    });
  },

  /**
   * Delete a session and its messages
   */
  async delete(appId: AppId, id: string): Promise<void> {
    const session = await db.kairaChatSessions.get(id);
    if (!session) return;
    
    if (session.appId !== appId) {
      throw new Error(`Session ${id} belongs to ${session.appId}, not ${appId}`);
    }
    
    // Delete all messages in this session
    await db.kairaChatMessages.where('sessionId').equals(id).delete();
    // Delete the session
    await db.kairaChatSessions.delete(id);
  },

  /**
   * Search sessions by title
   */
  async search(appId: AppId, query: string): Promise<KairaChatSession[]> {
    const lowerQuery = query.toLowerCase();
    return db.kairaChatSessions
      .where('appId')
      .equals(appId)
      .filter(session => session.title.toLowerCase().includes(lowerQuery))
      .toArray();
  },
};

export const chatMessagesRepository = {
  /**
   * Get all messages for a session
   */
  async getBySession(sessionId: string): Promise<KairaChatMessage[]> {
    return db.kairaChatMessages
      .where('sessionId')
      .equals(sessionId)
      .sortBy('timestamp');
  },

  /**
   * Create a new message
   */
  async create(
    message: Omit<KairaChatMessage, 'id'>
  ): Promise<KairaChatMessage> {
    const newMessage: KairaChatMessage = {
      ...message,
      id: generateId(),
    };
    await db.kairaChatMessages.add(newMessage);
    return newMessage;
  },

  /**
   * Update a message
   */
  async update(
    id: string,
    updates: Partial<Omit<KairaChatMessage, 'id' | 'sessionId'>>
  ): Promise<void> {
    await db.kairaChatMessages.update(id, updates);
  },

  /**
   * Delete a message
   */
  async delete(id: string): Promise<void> {
    await db.kairaChatMessages.delete(id);
  },

  /**
   * Delete all messages in a session
   */
  async deleteBySession(sessionId: string): Promise<void> {
    await db.kairaChatMessages.where('sessionId').equals(sessionId).delete();
  },

  /**
   * Get the last message in a session
   */
  async getLastInSession(sessionId: string): Promise<KairaChatMessage | undefined> {
    const messages = await db.kairaChatMessages
      .where('sessionId')
      .equals(sessionId)
      .reverse()
      .sortBy('timestamp');
    return messages[0];
  },
};
