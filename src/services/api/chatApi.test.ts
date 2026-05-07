import { beforeEach, expect, test, vi } from 'vitest';

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock('./client', () => ({
  apiRequest: apiRequestMock,
}));

import { chatSessionsRepository } from './chatApi';

beforeEach(() => {
  apiRequestMock.mockReset();
});

test('chat session API maps persisted isFirstMessage to frontend newSession', async () => {
  apiRequestMock.mockResolvedValue([
    {
      id: 'session-1',
      appId: 'kaira-bot',
      tenantId: 'tenant-1',
      userId: 'owner-1',
      externalUserId: 'kaira-user-1',
      serverSessionId: 'sess_abc',
      title: 'Lunch',
      status: 'active',
      isFirstMessage: false,
      createdAt: '2026-05-06T10:00:00.000Z',
      updatedAt: '2026-05-06T10:01:00.000Z',
    },
  ]);

  const sessions = await chatSessionsRepository.getAll('kaira-bot');

  expect(sessions[0].newSession).toBe(false);
});

test('chat session API writes frontend newSession to persisted isFirstMessage', async () => {
  apiRequestMock.mockResolvedValue({
    id: 'session-1',
    appId: 'kaira-bot',
    tenantId: 'tenant-1',
    userId: 'owner-1',
    externalUserId: 'kaira-user-1',
    title: 'New Chat',
    status: 'active',
    isFirstMessage: true,
    createdAt: '2026-05-06T10:00:00.000Z',
    updatedAt: '2026-05-06T10:00:00.000Z',
  });

  await chatSessionsRepository.create('kaira-bot', {
    userId: 'kaira-user-1',
    title: 'New Chat',
    status: 'active',
    newSession: true,
  });

  expect(apiRequestMock).toHaveBeenCalledWith(
    '/api/chat/sessions?app_id=kaira-bot',
    expect.objectContaining({
      body: JSON.stringify({
        appId: 'kaira-bot',
        externalUserId: 'kaira-user-1',
        serverSessionId: undefined,
        title: 'New Chat',
        status: 'active',
        isFirstMessage: true,
      }),
    }),
  );

  await chatSessionsRepository.update('kaira-bot', 'session-1', {
    serverSessionId: 'sess_abc',
    newSession: false,
  });

  expect(apiRequestMock).toHaveBeenLastCalledWith(
    '/api/chat/sessions/session-1?app_id=kaira-bot',
    expect.objectContaining({
      body: JSON.stringify({
        externalUserId: undefined,
        serverSessionId: 'sess_abc',
        title: undefined,
        status: undefined,
        isFirstMessage: false,
      }),
    }),
  );
});
