import { describe, expect, test } from 'vitest';
import { Flame, HelpCircle, ListChecks, Workflow } from 'lucide-react';

import { PAGE_METADATA, resolveLucide, resolvePageMetadata } from './pageMetadata';
import type { AppConfig } from '@/types';

describe('resolvePageMetadata', () => {
  test('returns code defaults when no app config is supplied', () => {
    const result = resolvePageMetadata('runs', null);
    expect(result.icon).toBe(ListChecks);
    expect(result.title).toBe('Runs');
  });

  test('app-config pageIcons override the default icon', () => {
    const config = { pageIcons: { runs: 'Flame' } } as unknown as AppConfig;
    const result = resolvePageMetadata('runs', config);
    expect(result.icon).toBe(Flame);
    expect(result.title).toBe('Runs');
  });

  test('app-config pageTitles override the default title', () => {
    const config = { pageTitles: { runs: 'Evaluation Runs' } } as unknown as AppConfig;
    const result = resolvePageMetadata('runs', config);
    expect(result.title).toBe('Evaluation Runs');
  });

  test('detail pages keep an empty default title for entity-derived headers', () => {
    expect(PAGE_METADATA.runDetail.title).toBe('');
    expect(resolvePageMetadata('runDetail', null).title).toBe('');
  });

  test('campaigns participates in shared page metadata defaults', () => {
    const result = resolvePageMetadata('campaigns', null);
    expect(result.icon).toBe(Workflow);
    expect(result.title).toBe('Campaigns');
  });
});

describe('resolveLucide', () => {
  test('returns HelpCircle for an unknown icon name (no throw)', () => {
    expect(resolveLucide('NotARealIcon')).toBe(HelpCircle);
  });

  test('returns HelpCircle for missing/empty input', () => {
    expect(resolveLucide(undefined)).toBe(HelpCircle);
    expect(resolveLucide('')).toBe(HelpCircle);
  });

  test('resolves a known lucide icon by name', () => {
    expect(resolveLucide('Flame')).toBe(Flame);
  });
});
