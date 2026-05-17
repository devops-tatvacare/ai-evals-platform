import { useMemo } from 'react';
import { useAppConfig } from '@/hooks';
import type { AppId } from '@/types/app.types';
import { runDetailConfigSchema, type RunDetailConfig } from '../config';

/**
 * Reads the per-app `runDetail` block from `App.config` and validates it
 * against `runDetailConfigSchema` once per appId. Throws on a missing or
 * invalid block — the page is fully config-driven, so "no config" =
 * "no page." Surfaces as an early error rather than a silent miswire.
 */
export function useAppRunDetailConfig(appId: AppId): RunDetailConfig {
  const appConfig = useAppConfig(appId);
  return useMemo(() => {
    const raw = appConfig.runDetail;
    if (!raw) {
      throw new Error(
        `App ${appId} has no runDetail config block. Seed it in seed_defaults.py + APP_CONFIG_FALLBACKS.`,
      );
    }
    const parsed = runDetailConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `App ${appId} runDetail config failed validation: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }, [appId, appConfig.runDetail]);
}
