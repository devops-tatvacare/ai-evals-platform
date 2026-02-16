/**
 * Chat API - HTTP client for chat sessions and messages API.
 *
 * Backend outputs camelCase via Pydantic alias_generator.
 * Thin mapping only for: session.userId ↔ externalUserId, message dates.
 */
import type { AppId, KairaChatSession, KairaChatMessage } from '@/types';
import { apiRequest } from './client';

/** API session shape (camelCase from backend) */
interface ApiSession {
  id: string;
  appId: string;
  externalUserId?: string;
  threadId?: string;
  serverSessionId?: string;
  lastResponseId?: string;
  title: string;
  status: string;
  isFirstMessage?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Map API session → frontend KairaChatSession */
function toSession(s: ApiSession): KairaChatSession {
  return {
    id: s.id,
    appId: s.appId as AppId,
    userId: s.externalUserId || '',
    threadId: s.threadId,
    serverSessionId: s.serverSessionId,
    lastResponseId: s.lastResponseId,
    title: s.title,
    status: s.status as 'active' | 'ended',
    isFirstMessage: s.isFirstMessage,
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  };
}

/** API message shape (camelCase from backend) */
interface ApiMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  metadata?: unknown;
  status: string;
  errorMessage?: string;
  createdAt: string;
}

/** Map API message → frontend KairaChatMessage */
function toMessage(m: ApiMessage): KairaChatMessage {
  return {
    id: m.id,
    sessionId: m.sessionId,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    metadata: m.metadata as KairaChatMessage['metadata'],
    createdAt: new Date(m.createdAt),
    status: m.status as KairaChatMessage['status'],
    errorMessage: m.errorMessage,
  };
}

export const chatSessionsRepository = {
  async getAll(appId: AppId): Promise<KairaChatSession[]> {
    const data = await apiRequest<ApiSession[]>(`/api/chat/sessions?app_id=${appId}`);
    return data.map(toSession);
  },

  async getById(_appId: AppId, id: string): Promise<KairaChatSession | undefined> {
    try {
      const data = await apiRequest<ApiSession>(`/api/chat/sessions/${id}`);
      return toSession(data);
    } catch {
      return undefined;
    }
  },

  async create(
    appId: AppId,
    session: Omit<KairaChatSession, 'id' | 'appId' | 'createdAt' | 'updatedAt'>
  ): Promise<KairaChatSession> {
    const data = await apiRequest<ApiSession>('/api/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({
        appId,
        externalUserId: session.userId,
        threadId: session.threadId,
        serverSessionId: session.serverSessionId,
        lastResponseId: session.lastResponseId,
        title: session.title,
        status: session.status,
        isFirstMessage: session.isFirstMessage,
      }),
    });
    return toSession(data);
  },

  async update(
    _appId: AppId,
    id: string,
    updates: Partial<Omit<KairaChatSession, 'id' | 'appId' | 'createdAt'>>
  ): Promise<void> {
    await apiRequest(`/api/chat/sessions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        externalUserId: updates.userId,
        threadId: updates.threadId,
        serverSessionId: updates.serverSessionId,
        lastResponseId: updates.lastResponseId,
        title: updates.title,
        status: updates.status,
        isFirstMessage: updates.isFirstMessage,
      }),
    });
  },

  async delete(_appId: AppId, id: string): Promise<void> {
    await apiRequest(`/api/chat/sessions/${id}`, { method: 'DELETE' });
  },

  async search(appId: AppId, query: string): Promise<KairaChatSession[]> {
    const all = await this.getAll(appId);
    const lowerQuery = query.toLowerCase();
    return all.filter(s => s.title.toLowerCase().includes(lowerQuery));
  },
};

export const chatMessagesRepository = {
  async getBySession(sessionId: string): Promise<KairaChatMessage[]> {
    const data = await apiRequest<ApiMessage[]>(`/api/chat/sessions/${sessionId}/messages`);
    return data.map(toMessage);
  },

  async create(message: Omit<KairaChatMessage, 'id'>): Promise<KairaChatMessage> {
    const data = await apiRequest<ApiMessage>('/api/chat/messages', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: message.sessionId,
        role: message.role,
        content: message.content,
        metadata: message.metadata,
        status: message.status,
        errorMessage: message.errorMessage,
      }),
    });
    return toMessage(data);
  },

  async update(
    id: string,
    updates: Partial<Omit<KairaChatMessage, 'id' | 'sessionId'>>
  ): Promise<void> {
    await apiRequest(`/api/chat/messages/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        role: updates.role,
        content: updates.content,
        metadata: updates.metadata,
        status: updates.status,
        errorMessage: updates.errorMessage,
      }),
    });
  },

  async delete(id: string): Promise<void> {
    await apiRequest(`/api/chat/messages/${id}`, { method: 'DELETE' });
  },

  async deleteBySession(sessionId: string): Promise<void> {
    const messages = await this.getBySession(sessionId);
    for (const message of messages) {
      await this.delete(message.id);
    }
  },

  async addTag(messageId: string, tagName: string): Promise<void> {
    const message = await apiRequest<{ metadata?: { tags?: string[] } }>(
      `/api/chat/messages/${messageId}`
    );
    const currentTags = message.metadata?.tags || [];
    const normalizedTag = tagName.trim().toLowerCase();

    if (!currentTags.includes(normalizedTag)) {
      await apiRequest(`/api/chat/messages/${messageId}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ tags: [...currentTags, normalizedTag] }),
      });
    }
  },

  async removeTag(messageId: string, tagName: string): Promise<void> {
    const message = await apiRequest<{ metadata?: { tags?: string[] } }>(
      `/api/chat/messages/${messageId}`
    );
    const currentTags = message.metadata?.tags || [];
    const normalizedTag = tagName.trim().toLowerCase();

    await apiRequest(`/api/chat/messages/${messageId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tags: currentTags.filter(t => t !== normalizedTag) }),
    });
  },

  async updateTags(messageId: string, tags: string[]): Promise<void> {
    await apiRequest(`/api/chat/messages/${messageId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tags: tags.map(t => t.trim().toLowerCase()) }),
    });
  },

  async renameTagInAllMessages(oldTag: string, newTag: string): Promise<void> {
    await apiRequest('/api/chat/messages/tags/rename', {
      method: 'PUT',
      body: JSON.stringify({
        old_tag: oldTag.trim().toLowerCase(),
        new_tag: newTag.trim().toLowerCase(),
      }),
    });
  },

  async deleteTagFromAllMessages(tagName: string): Promise<void> {
    await apiRequest('/api/chat/messages/tags/delete', {
      method: 'DELETE',
      body: JSON.stringify({ tag: tagName.trim().toLowerCase() }),
    });
  },
};
