/**
 * Chat API - HTTP client for chat sessions and messages API.
 *
 * Backend outputs camelCase via Pydantic alias_generator.
 * Thin mapping only for: session.userId ↔ externalUserId, message dates.
 */
import type { AppId, KairaChatSession, KairaChatMessage } from '@/types';
import { apiRequest } from './client';

export const CHAT_SESSION_SOURCE = {
  sherlock: 'sherlock',
} as const;

export type ChatSessionSource = (typeof CHAT_SESSION_SOURCE)[keyof typeof CHAT_SESSION_SOURCE];

function withAppId(path: string, appId: AppId): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}app_id=${encodeURIComponent(appId)}`;
}

/** API session shape (camelCase from backend) */
interface ApiSession {
  id: string;
  appId: string;
  tenantId: string;
  userId: string;
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
    tenantId: s.tenantId,
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
  async getAll(appId: AppId, source?: ChatSessionSource): Promise<KairaChatSession[]> {
    let path = withAppId('/api/chat/sessions', appId);
    if (source) path += `&source=${encodeURIComponent(source)}`;
    const data = await apiRequest<ApiSession[]>(path);
    return data.map(toSession);
  },

  async getById(appId: AppId, id: string): Promise<KairaChatSession | undefined> {
    try {
      const data = await apiRequest<ApiSession>(withAppId(`/api/chat/sessions/${id}`, appId));
      return toSession(data);
    } catch {
      return undefined;
    }
  },

  async create(
    appId: AppId,
    session: Omit<KairaChatSession, 'id' | 'appId' | 'tenantId' | 'createdAt' | 'updatedAt'>
  ): Promise<KairaChatSession> {
    const data = await apiRequest<ApiSession>(withAppId('/api/chat/sessions', appId), {
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
    appId: AppId,
    id: string,
    updates: Partial<Omit<KairaChatSession, 'id' | 'appId' | 'tenantId' | 'createdAt'>>
  ): Promise<void> {
    await apiRequest(withAppId(`/api/chat/sessions/${id}`, appId), {
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

  async delete(appId: AppId, id: string): Promise<void> {
    await apiRequest(withAppId(`/api/chat/sessions/${id}`, appId), { method: 'DELETE' });
  },

  async search(appId: AppId, query: string): Promise<KairaChatSession[]> {
    const all = await this.getAll(appId);
    const lowerQuery = query.toLowerCase();
    return all.filter(s => s.title.toLowerCase().includes(lowerQuery));
  },
};

export const chatMessagesRepository = {
  async getBySession(appId: AppId, sessionId: string): Promise<KairaChatMessage[]> {
    const data = await apiRequest<ApiMessage[]>(withAppId(`/api/chat/sessions/${sessionId}/messages`, appId));
    return data.map(toMessage);
  },

  async create(appId: AppId, message: Omit<KairaChatMessage, 'id'>): Promise<KairaChatMessage> {
    const data = await apiRequest<ApiMessage>(withAppId('/api/chat/messages', appId), {
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
    appId: AppId,
    id: string,
    updates: Partial<Omit<KairaChatMessage, 'id' | 'sessionId'>>
  ): Promise<void> {
    await apiRequest(withAppId(`/api/chat/messages/${id}`, appId), {
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

  async delete(appId: AppId, id: string): Promise<void> {
    await apiRequest(withAppId(`/api/chat/messages/${id}`, appId), { method: 'DELETE' });
  },

  async deleteBySession(appId: AppId, sessionId: string): Promise<void> {
    const messages = await this.getBySession(appId, sessionId);
    for (const message of messages) {
      await this.delete(appId, message.id);
    }
  },

  async addTag(appId: AppId, messageId: string, tagName: string): Promise<void> {
    const msg = await apiRequest<ApiMessage>(withAppId(`/api/chat/messages/${messageId}`, appId));
    const meta = (msg.metadata ?? {}) as Record<string, unknown>;
    const currentTags = (meta.tags ?? []) as string[];
    const normalizedTag = tagName.trim().toLowerCase();

    if (!currentTags.includes(normalizedTag)) {
      await apiRequest(withAppId(`/api/chat/messages/${messageId}`, appId), {
        method: 'PUT',
        body: JSON.stringify({
          metadata: { ...meta, tags: [...currentTags, normalizedTag] },
        }),
      });
    }
  },

  async removeTag(appId: AppId, messageId: string, tagName: string): Promise<void> {
    const msg = await apiRequest<ApiMessage>(withAppId(`/api/chat/messages/${messageId}`, appId));
    const meta = (msg.metadata ?? {}) as Record<string, unknown>;
    const currentTags = (meta.tags ?? []) as string[];
    const normalizedTag = tagName.trim().toLowerCase();

    await apiRequest(withAppId(`/api/chat/messages/${messageId}`, appId), {
      method: 'PUT',
      body: JSON.stringify({
        metadata: { ...meta, tags: currentTags.filter(t => t !== normalizedTag) },
      }),
    });
  },

  async updateTags(appId: AppId, messageId: string, tags: string[]): Promise<void> {
    const msg = await apiRequest<ApiMessage>(withAppId(`/api/chat/messages/${messageId}`, appId));
    const meta = (msg.metadata ?? {}) as Record<string, unknown>;

    await apiRequest(withAppId(`/api/chat/messages/${messageId}`, appId), {
      method: 'PUT',
      body: JSON.stringify({
        metadata: { ...meta, tags: tags.map(t => t.trim().toLowerCase()) },
      }),
    });
  },

  async renameTagInAllMessages(oldTag: string, newTag: string): Promise<void> {
    await apiRequest('/api/chat/messages/tags/rename', {
      method: 'PUT',
      body: JSON.stringify({
        oldTag: oldTag.trim().toLowerCase(),
        newTag: newTag.trim().toLowerCase(),
      }),
    });
  },

  async deleteTagFromAllMessages(tagName: string): Promise<void> {
    await apiRequest('/api/chat/messages/tags/delete', {
      method: 'POST',
      body: JSON.stringify({ tag: tagName.trim().toLowerCase() }),
    });
  },
};
