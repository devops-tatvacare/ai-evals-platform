import { expect, test } from 'vitest';

import { APP_CONFIG_FALLBACKS, mergeAppConfig } from './app.types';

test('kaira fallback rule catalog points at adversarial config', () => {
  expect(APP_CONFIG_FALLBACKS['kaira-bot'].rules).toMatchObject({
    catalogSource: 'settings',
    catalogKey: 'adversarial-config',
    autoMatch: true,
  });
});

test('mergeAppConfig preserves fallback chat prompt templates for partial backend chat config', () => {
  const merged = mergeAppConfig('kaira-bot', {
    chat: {
      enabled: true,
      capabilities: ['discovery'],
    },
  });

  expect(merged.chat.promptTemplates).toEqual(APP_CONFIG_FALLBACKS['kaira-bot'].chat.promptTemplates);
  expect(merged.chat.capabilities).toEqual(['discovery']);
  expect(merged.chat.dataSurfaces).toEqual(APP_CONFIG_FALLBACKS['kaira-bot'].chat.dataSurfaces);
  expect(merged.chat.entityResolvers).toEqual(APP_CONFIG_FALLBACKS['kaira-bot'].chat.entityResolvers);
});

test('mergeAppConfig respects backend chat prompt templates when explicitly provided', () => {
  const merged = mergeAppConfig('kaira-bot', {
    chat: {
      enabled: true,
      promptTemplates: [{ label: 'Custom', prompt: 'Use the custom prompt' }],
    },
  });

  expect(merged.chat.promptTemplates).toEqual([{ label: 'Custom', prompt: 'Use the custom prompt' }]);
});

test('mergeAppConfig preserves backend sherlock surfaces and entity resolvers', () => {
  const merged = mergeAppConfig('kaira-bot', {
    chat: {
      dataSurfaces: [{ key: 'logs', description: 'Raw logs', source: 'api_logs' }],
      entityResolvers: [{ key: 'thread-id', entityType: 'thread_id', source: 'api_logs', field: 'thread_id' }],
    },
  });

  expect(merged.chat.dataSurfaces).toEqual([{ key: 'logs', description: 'Raw logs', source: 'api_logs' }]);
  expect(merged.chat.entityResolvers).toEqual([{ key: 'thread-id', entityType: 'thread_id', source: 'api_logs', field: 'thread_id' }]);
});
