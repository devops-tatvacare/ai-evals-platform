import { afterEach, test, expect } from 'vitest';

import {
  firstAccessibleRoute,
  homeRouteForApp,
  inferAppIdFromPath,
  resetAppNavigationRegistry,
  routes,
  runDetailForApp,
  syncAppNavigation,
  threadDetailForApp,
} from './routes';

afterEach(() => {
  resetAppNavigationRegistry();
});

test('homeRouteForApp maps kaira-bot slug to kaira dashboard route', () => {
  expect(homeRouteForApp('kaira-bot')).toBe(routes.kaira.home);
});

test('homeRouteForApp maps inside-sales slug to inside sales home route', () => {
  expect(homeRouteForApp('inside-sales')).toBe(routes.insideSales.home);
});

test('firstAccessibleRoute returns the first valid app home route', () => {
  expect(firstAccessibleRoute(['kaira-bot'])).toBe(routes.kaira.home);
});

test('firstAccessibleRoute falls back to voice rx home when there is no app access', () => {
  expect(firstAccessibleRoute([])).toBe(routes.voiceRx.home);
});

test('homeRouteForApp respects backend-driven navigation overrides', () => {
  syncAppNavigation('kaira-bot', { homePath: '/assistant' });

  expect(homeRouteForApp('kaira-bot')).toBe('/assistant');
  expect(firstAccessibleRoute(['kaira-bot'])).toBe('/assistant');
});

test('inferAppIdFromPath uses configured owned path prefixes instead of hardcoded slugs', () => {
  syncAppNavigation('kaira-bot', {
    homePath: '/assistant',
    ownedPathPrefixes: ['/assistant'],
  });

  expect(inferAppIdFromPath('/assistant/runs/123')).toBe('kaira-bot');
});

test('runDetailForApp uses configured path templates', () => {
  syncAppNavigation('inside-sales', {
    runDetailPath: '/revenue/runs/:runId',
  });

  expect(runDetailForApp('inside-sales', 'run-42')).toBe('/revenue/runs/run-42');
});

test('threadDetailForApp fills all required template params and returns null when missing', () => {
  expect(
    threadDetailForApp('inside-sales', 'thread-9', 'run-7'),
  ).toBe('/inside-sales/runs/run-7/calls/thread-9');
  expect(threadDetailForApp('inside-sales', 'thread-9')).toBeNull();
});
