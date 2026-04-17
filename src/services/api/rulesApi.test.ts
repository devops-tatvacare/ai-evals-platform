import { beforeEach, expect, test, vi } from 'vitest';

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock('./client', () => ({
  apiRequest: apiRequestMock,
}));

import { rulesRepository } from './rulesApi';

beforeEach(() => {
  apiRequestMock.mockReset();
});

test('rulesRepository includes configured catalog key when loading app rules', async () => {
  apiRequestMock.mockResolvedValue({
    rules: [
      {
        ruleId: 'ask_time_if_missing',
        ruleText: 'Ask for meal time if it is missing.',
        section: 'Time Validation',
        tags: [],
        goalIds: ['meal_logged'],
        evaluationScopes: ['adversarial'],
      },
    ],
  });

  const response = await rulesRepository.get('kaira-bot', {
    catalogSource: 'settings',
    catalogKey: 'adversarial-config',
    autoMatch: true,
  });

  expect(apiRequestMock).toHaveBeenCalledWith(
    '/api/rules?app_id=kaira-bot&catalog_key=adversarial-config',
  );
  expect(response.rules).toEqual([
    {
      ruleId: 'ask_time_if_missing',
      ruleText: 'Ask for meal time if it is missing.',
      section: 'Time Validation',
      tags: [],
      goalIds: ['meal_logged'],
      evaluationScopes: ['adversarial'],
    },
  ]);
});
