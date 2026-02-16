/**
 * Chat API - HTTP implementation replacing Dexie-based chat repositories.
 * Exports both chatSessionsRepository and chatMessagesRepository.
 */
import type { AppId, KairaChatSession, KairaChatMessage } from '@/types';
import { apiRequest } from './client';

export const chatSessionsRepository = {
  async getAll(appId: AppId): Promise<KairaChatSession[]> {
    const data = await apiRequest<Array<{
      id: string;
      app_id: string;
      external_user_id?: string;
      thread_id?: string;
      server_session_id?: string;
      last_response_id?: string;
      title: string;
      status: string;
      is_first_message?: boolean;
      created_at: string;
      updated_at: string;
    }>>(`/api/chat/sessions?app_id=${appId}`);

    return data.map(s => ({
      id: s.id,
      appId: s.app_id as AppId,
      userId: s.external_user_id || '',
      threadId: s.thread_id,
      serverSessionId: s.server_session_id,
      lastResponseId: s.last_response_id,
      title: s.title,
      status: s.status as 'active' | 'ended',
      isFirstMessage: s.is_first_message,
      createdAt: new Date(s.created_at),
      updatedAt: new Date(s.updated_at),
    }));
  },

  async getById(appId: AppId, id: string): Promise<KairaChatSession | undefined> {
    try {
      const data = await apiRequest<{
        id: string;
        app_id: string;
        external_user_id?: string;
        thread_id?: string;
        server_session_id?: string;
        last_response_id?: string;
        title: string;
        status: string;
        is_first_message?: boolean;
        created_at: string;
        updated_at: string;
      }>(`/api/chat/sessions/${id}`);

      return {
        id: data.id,
        appId: data.app_id as AppId,
        userId: data.external_user_id || '',
        threadId: data.thread_id,
        serverSessionId: data.server_session_id,
        lastResponseId: data.last_response_id,
        title: data.title,
        status: data.status as 'active' | 'ended',
        isFirstMessage: data.is_first_message,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      };
    } catch (err) {
      return undefined;
    }
  },

  async create(
    appId: AppId,
    session: Omit<KairaChatSession, 'id' | 'appId' | 'createdAt' | 'updatedAt'>
  ): Promise<KairaChatSession> {
    const data = await apiRequest<{
      id: string;
      app_id: string;
      external_user_id?: string;
      thread_id?: string;
      server_session_id?: string;
      last_response_id?: string;
      title: string;
      status: string;
      is_first_message?: boolean;
      created_at: string;
      updated_at: string;
    }>('/api/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({
        app_id: appId,
        external_user_id: session.userId,
        thread_id: session.threadId,
        server_session_id: session.serverSessionId,
        last_response_id: session.lastResponseId,
        title: session.title,
        status: session.status,
        is_first_message: session.isFirstMessage,
      }),
    });

    return {
      id: data.id,
      appId: data.app_id as AppId,
      userId: data.external_user_id || '',
      threadId: data.thread_id,
      serverSessionId: data.server_session_id,
      lastResponseId: data.last_response_id,
      title: data.title,
      status: data.status as 'active' | 'ended',
      isFirstMessage: data.is_first_message,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  },

  async update(
    appId: AppId,
    id: string,
    updates: Partial<Omit<KairaChatSession, 'id' | 'appId' | 'createdAt'>>
  ): Promise<void> {
    await apiRequest(`/api/chat/sessions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        external_user_id: updates.userId,
        thread_id: updates.threadId,
        server_session_id: updates.serverSessionId,
        last_response_id: updates.lastResponseId,
        title: updates.title,
        status: updates.status,
        is_first_message: updates.isFirstMessage,
      }),
    });
  },

  async delete(appId: AppId, id: string): Promise<void> {
    await apiRequest(`/api/chat/sessions/${id}`, {
      method: 'DELETE',
    });
  },

  async search(appId: AppId, query: string): Promise<KairaChatSession[]> {
    // Client-side search for now (or implement server-side search endpoint)
    const all = await this.getAll(appId);
    const lowerQuery = query.toLowerCase();
    return all.filter(s => s.title.toLowerCase().includes(lowerQuery));
  },
};

export const chatMessagesRepository = {
  async getBySession(sessionId: string): Promise<KairaChatMessage[]> {
    const data = await apiRequest<Array<{
      id: string;
      session_id: string;
      role: string;
      content: string;
      metadata?: unknown;
      status: string;
      error_message?: string;
      created_at: string;
    }>>(`/api/chat/sessions/${sessionId}/messages`);

    return data.map(m => ({
      id: m.id,
      sessionId: m.session_id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      metadata: m.metadata as KairaChatMessage['metadata'],
      timestamp: new Date(m.created_at),
      status: m.status as KairaChatMessage['status'],
      errorMessage: m.error_message,
    }));
  },

  async create(
    message: Omit<KairaChatMessage, 'id'>
  ): Promise<KairaChatMessage> {
    const data = await apiRequest<{
      id: string;
      session_id: string;
      role: string;
      content: string;
      metadata?: unknown;
      status: string;
      error_message?: string;
      created_at: string;
    }>('/api/chat/messages', {
      method: 'POST',
      body: JSON.stringify({
        session_id: message.sessionId,
        role: message.role,
        content: message.content,
        metadata: message.metadata,
        status: message.status,
        error_message: message.errorMessage,
      }),
    });

    return {
      id: data.id,
      sessionId: data.session_id,
      role: data.role as 'user' | 'assistant',
      content: data.content,
      metadata: data.metadata as KairaChatMessage['metadata'],
      timestamp: new Date(data.created_at),
      status: data.status as KairaChatMessage['status'],
      errorMessage: data.error_message,
    };
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
        error_message: updates.errorMessage,
      }),
    });
  },

  async delete(id: string): Promise<void> {
    await apiRequest(`/api/chat/messages/${id}`, {
      method: 'DELETE',
    });
  },

  async deleteBySession(sessionId: string): Promise<void> {
    // This is handled by cascade delete on the backend
    // But we can also provide explicit endpoint if needed
    const messages = await this.getBySession(sessionId);
    for (const message of messages) {
      await this.delete(message.id);
    }
  },

  async addTag(messageId: string, tagName: string): Promise<void> {
    const message = await apiRequest<{
      metadata?: { tags?: string[] };
    }>(`/api/chat/messages/${messageId}`);

    const currentTags = message.metadata?.tags || [];
    const normalizedTag = tagName.trim().toLowerCase();

    if (!currentTags.includes(normalizedTag)) {
      await apiRequest(`/api/chat/messages/${messageId}/tags`, {
        method: 'PUT',
        body: JSON.stringify({
          tags: [...currentTags, normalizedTag],
        }),
      });
    }
  },

  async removeTag(messageId: string, tagName: string): Promise<void> {
    const message = await apiRequest<{
      metadata?: { tags?: string[] };
    }>(`/api/chat/messages/${messageId}`);

    const currentTags = message.metadata?.tags || [];
    const normalizedTag = tagName.trim().toLowerCase();

    await apiRequest(`/api/chat/messages/${messageId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({
        tags: currentTags.filter(t => t !== normalizedTag),
      }),
    });
  },

  async updateTags(messageId: string, tags: string[]): Promise<void> {
    await apiRequest(`/api/chat/messages/${messageId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({
        tags: tags.map(t => t.trim().toLowerCase()),
      }),
    });
  },

  async renameTagInAllMessages(oldTag: string, newTag: string): Promise<void> {
    // This should be handled by a backend endpoint
    // For now, we'll make a generic call
    await apiRequest('/api/chat/messages/tags/rename', {
      method: 'PUT',
      body: JSON.stringify({
        old_tag: oldTag.trim().toLowerCase(),
        new_tag: newTag.trim().toLowerCase(),
      }),
    });
  },

  async deleteTagFromAllMessages(tagName: string): Promise<void> {
    // This should be handled by a backend endpoint
    await apiRequest('/api/chat/messages/tags/delete', {
      method: 'DELETE',
      body: JSON.stringify({
        tag: tagName.trim().toLowerCase(),
      }),
    });
  },
};
