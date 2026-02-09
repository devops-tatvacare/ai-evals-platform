/**
 * Chat Repository
 * Database operations for Kaira chat sessions and messages using entities table
 */

import { saveEntity, getEntities, deleteEntity, getEntity } from './db';
import type { AppId, KairaChatSession, KairaChatMessage } from '@/types';
import { generateId } from '@/utils';

export const chatSessionsRepository = {
  /**
   * Get all chat sessions for a specific app
   */
  async getAll(appId: AppId): Promise<KairaChatSession[]> {
    const entities = await getEntities('chatSession', appId);
    const sessions = entities.map(e => e.data as unknown as KairaChatSession);
    // Sort by updatedAt descending
    return sessions.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  },

  /**
   * Get a session by ID
   */
  async getById(appId: AppId, id: string): Promise<KairaChatSession | undefined> {
    const entity = await getEntity('chatSession', appId, id);
    if (!entity) return undefined;
    
    const session = entity.data as unknown as KairaChatSession;
    if (session.appId !== appId) {
      console.warn(`Session ${id} belongs to ${session.appId}, not ${appId}`);
      return undefined;
    }
    return session;
  },

  /**
   * Get sessions by user ID
   */
  async getByUserId(appId: AppId, userId: string): Promise<KairaChatSession[]> {
    const entities = await getEntities('chatSession', appId);
    const sessions = entities
      .map(e => e.data as unknown as KairaChatSession)
      .filter(session => session.userId === userId);
    // Sort by updatedAt descending
    return sessions.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
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
    
    await saveEntity({
      appId,
      type: 'chatSession',
      key: newSession.id,  // Session ID as key
      version: null,
      data: newSession as unknown as Record<string, unknown>,
    });
    
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
    const entity = await getEntity('chatSession', appId, id);
    if (!entity) {
      throw new Error(`Session ${id} not found`);
    }
    
    const session = entity.data as unknown as KairaChatSession;
    if (session.appId !== appId) {
      throw new Error(`Session ${id} belongs to ${session.appId}, not ${appId}`);
    }
    
    const updatedSession = {
      ...session,
      ...updates,
      updatedAt: new Date(),
    };
    
    await saveEntity({
      id: entity.id,
      appId,
      type: 'chatSession',
      key: id,
      version: null,
      data: updatedSession as unknown as Record<string, unknown>,
    });
  },

  /**
   * Delete a session and its messages
   */
  async delete(appId: AppId, id: string): Promise<void> {
    const entity = await getEntity('chatSession', appId, id);
    if (!entity) return;
    
    const session = entity.data as unknown as KairaChatSession;
    if (session.appId !== appId) {
      throw new Error(`Session ${id} belongs to ${session.appId}, not ${appId}`);
    }
    
    // Delete all messages in this session
    await chatMessagesRepository.deleteBySession(id);
    
    // Delete the session
    await deleteEntity(entity.id!);
  },

  /**
   * Search sessions by title
   */
  async search(appId: AppId, query: string): Promise<KairaChatSession[]> {
    const lowerQuery = query.toLowerCase();
    const entities = await getEntities('chatSession', appId);
    return entities
      .map(e => e.data as unknown as KairaChatSession)
      .filter(session => session.title.toLowerCase().includes(lowerQuery));
  },
};

export const chatMessagesRepository = {
  /**
   * Get all messages for a session
   */
  async getBySession(sessionId: string): Promise<KairaChatMessage[]> {
    // Messages are stored with key = sessionId for easy filtering
    const entities = await getEntities('chatMessage', null, sessionId);
    const messages = entities.map(e => e.data as unknown as KairaChatMessage);
    // Sort by timestamp ascending
    return messages.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
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
    
    await saveEntity({
      appId: null,  // Messages are global, associated by sessionId
      type: 'chatMessage',
      key: message.sessionId,  // Use sessionId as key for filtering
      version: null,
      data: newMessage as unknown as Record<string, unknown>,
    });
    
    return newMessage;
  },

  /**
   * Update a message
   */
  async update(
    id: string,
    updates: Partial<Omit<KairaChatMessage, 'id' | 'sessionId'>>
  ): Promise<void> {
    // Find the message entity by iterating (since we need to match message.id in data)
    const allMessages = await getEntities('chatMessage', null);
    const entity = allMessages.find(e => (e.data as unknown as KairaChatMessage).id === id);
    
    if (!entity) {
      throw new Error(`Message ${id} not found`);
    }
    
    const message = entity.data as unknown as KairaChatMessage;
    const updatedMessage = {
      ...message,
      ...updates,
    };
    
    await saveEntity({
      id: entity.id,
      appId: null,
      type: 'chatMessage',
      key: message.sessionId,
      version: null,
      data: updatedMessage as unknown as Record<string, unknown>,
    });
  },

  /**
   * Delete a message
   */
  async delete(id: string): Promise<void> {
    // Find the message entity by iterating
    const allMessages = await getEntities('chatMessage', null);
    const entity = allMessages.find(e => (e.data as unknown as KairaChatMessage).id === id);
    
    if (entity) {
      await deleteEntity(entity.id!);
    }
  },

  /**
   * Delete all messages in a session
   */
  async deleteBySession(sessionId: string): Promise<void> {
    const entities = await getEntities('chatMessage', null, sessionId);
    for (const entity of entities) {
      await deleteEntity(entity.id!);
    }
  },

  /**
   * Get the last message in a session
   */
  async getLastInSession(sessionId: string): Promise<KairaChatMessage | undefined> {
    const messages = await this.getBySession(sessionId);
    return messages[messages.length - 1];
  },

  /**
   * Add a tag to a message
   */
  async addTag(messageId: string, tagName: string): Promise<void> {
    const allMessages = await getEntities('chatMessage', null);
    const entity = allMessages.find(e => (e.data as unknown as KairaChatMessage).id === messageId);
    
    if (!entity) {
      throw new Error(`Message ${messageId} not found`);
    }
    
    const message = entity.data as unknown as KairaChatMessage;
    const currentTags = message.metadata?.tags || [];
    
    // Check if tag already exists (case-insensitive)
    const normalizedTag = tagName.trim().toLowerCase();
    if (currentTags.some(t => t.toLowerCase() === normalizedTag)) {
      return; // Tag already exists
    }
    
    const updatedTags = [...currentTags, normalizedTag];
    
    await this.update(messageId, {
      metadata: {
        ...message.metadata,
        tags: updatedTags,
      },
    });
  },

  /**
   * Remove a tag from a message
   */
  async removeTag(messageId: string, tagName: string): Promise<void> {
    const allMessages = await getEntities('chatMessage', null);
    const entity = allMessages.find(e => (e.data as unknown as KairaChatMessage).id === messageId);
    
    if (!entity) {
      throw new Error(`Message ${messageId} not found`);
    }
    
    const message = entity.data as unknown as KairaChatMessage;
    const currentTags = message.metadata?.tags || [];
    
    const normalizedTag = tagName.trim().toLowerCase();
    const updatedTags = currentTags.filter(t => t.toLowerCase() !== normalizedTag);
    
    await this.update(messageId, {
      metadata: {
        ...message.metadata,
        tags: updatedTags,
      },
    });
  },

  /**
   * Update all tags for a message
   */
  async updateTags(messageId: string, tags: string[]): Promise<void> {
    const allMessages = await getEntities('chatMessage', null);
    const entity = allMessages.find(e => (e.data as unknown as KairaChatMessage).id === messageId);
    
    if (!entity) {
      throw new Error(`Message ${messageId} not found`);
    }
    
    const message = entity.data as unknown as KairaChatMessage;
    
    await this.update(messageId, {
      metadata: {
        ...message.metadata,
        tags: tags.map(t => t.trim().toLowerCase()),
      },
    });
  },

  /**
   * Rename a tag across all messages in an app
   */
  async renameTagInAllMessages(oldTag: string, newTag: string): Promise<void> {
    const allMessages = await getEntities('chatMessage', null);
    const oldNormalized = oldTag.trim().toLowerCase();
    const newNormalized = newTag.trim().toLowerCase();
    
    for (const entity of allMessages) {
      const message = entity.data as unknown as KairaChatMessage;
      const currentTags = message.metadata?.tags || [];
      
      if (currentTags.some(t => t.toLowerCase() === oldNormalized)) {
        const updatedTags = currentTags.map(t => 
          t.toLowerCase() === oldNormalized ? newNormalized : t
        );
        
        await saveEntity({
          id: entity.id,
          appId: null,
          type: 'chatMessage',
          key: message.sessionId,
          version: null,
          data: {
            ...message,
            metadata: {
              ...message.metadata,
              tags: updatedTags,
            },
          } as unknown as Record<string, unknown>,
        });
      }
    }
  },

  /**
   * Delete a tag from all messages
   */
  async deleteTagFromAllMessages(tagName: string): Promise<void> {
    const allMessages = await getEntities('chatMessage', null);
    const normalized = tagName.trim().toLowerCase();
    
    for (const entity of allMessages) {
      const message = entity.data as unknown as KairaChatMessage;
      const currentTags = message.metadata?.tags || [];
      
      if (currentTags.some(t => t.toLowerCase() === normalized)) {
        const updatedTags = currentTags.filter(t => t.toLowerCase() !== normalized);
        
        await saveEntity({
          id: entity.id,
          appId: null,
          type: 'chatMessage',
          key: message.sessionId,
          version: null,
          data: {
            ...message,
            metadata: {
              ...message.metadata,
              tags: updatedTags,
            },
          } as unknown as Record<string, unknown>,
        });
      }
    }
  },
};
