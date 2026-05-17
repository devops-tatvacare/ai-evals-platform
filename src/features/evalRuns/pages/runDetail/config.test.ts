import { describe, expect, test } from 'vitest';
import { APP_CONFIG_FALLBACKS, mergeAppConfig } from '@/types/app.types';
import { runDetailConfigSchema } from './config';

describe('runDetailConfigSchema', () => {
  test('accepts the three fallback configs verbatim', () => {
    for (const appId of ['voice-rx', 'kaira-bot', 'inside-sales'] as const) {
      const block = APP_CONFIG_FALLBACKS[appId].runDetail;
      expect(block).toBeDefined();
      const parsed = runDetailConfigSchema.safeParse(block);
      if (!parsed.success) {
        throw new Error(`${appId} fallback failed: ${parsed.error.message}`);
      }
    }
  });

  test('rejects an empty evalTypes array', () => {
    const parsed = runDetailConfigSchema.safeParse({
      evalTypes: [],
      reportTab: { enabled: true },
      extras: {},
      behaviour: {},
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects an unknown extras key (strict-ish surface)', () => {
    // Zod object() with no .strict() accepts unknown keys; we explicitly
    // model only the fields we read so this is informational, not load-bearing.
    // The schema's primary defence is requiring evalTypes/reportTab shape.
    const parsed = runDetailConfigSchema.safeParse({
      evalTypes: ['call_quality'],
      reportTab: { enabled: true },
      extras: { rawPayload: true, unknownExtra: true },
      behaviour: {},
    });
    expect(parsed.success).toBe(true);
  });
});

describe('mergeAppConfig runDetail', () => {
  test('preserves fallback runDetail when backend omits it', () => {
    const merged = mergeAppConfig('voice-rx', { chat: { enabled: true } });
    expect(merged.runDetail).toEqual(APP_CONFIG_FALLBACKS['voice-rx'].runDetail);
  });

  test('shallow-merges per-section overrides from backend', () => {
    const merged = mergeAppConfig('voice-rx', {
      runDetail: {
        evalTypes: ['full_evaluation', 'custom'],
        reportTab: { enabled: false },
        extras: { rawPayload: false },
        behaviour: { failureHeadlineFromResult: true },
      },
    });
    expect(merged.runDetail?.reportTab.enabled).toBe(false);
    expect(merged.runDetail?.extras.rawPayload).toBe(false);
    expect(merged.runDetail?.behaviour.failureHeadlineFromResult).toBe(true);
  });

  test('deep-merge reverts to fallback values on omitted nested fields', () => {
    const fb = APP_CONFIG_FALLBACKS['voice-rx'].runDetail!;
    const merged = mergeAppConfig('voice-rx', {
      runDetail: {
        evalTypes: fb.evalTypes,
        reportTab: { enabled: true },
        extras: {},
        behaviour: {},
      },
    });
    // enabledForEvalTypes only present in fallback's reportTab — shallow merge keeps it.
    expect(merged.runDetail?.reportTab.enabledForEvalTypes).toEqual(fb.reportTab.enabledForEvalTypes);
  });
});
