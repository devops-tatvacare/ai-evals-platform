import { beforeEach, expect, test, vi } from 'vitest';

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock('./client', () => ({
  apiRequest: apiRequestMock,
}));

import { aiSettingsApi } from './aiSettingsApi';

beforeEach(() => {
  apiRequestMock.mockReset();
});

test('list hits the providers index', async () => {
  apiRequestMock.mockResolvedValue([]);
  await aiSettingsApi.list();
  expect(apiRequestMock).toHaveBeenCalledWith('/api/admin/ai-settings/providers');
});
