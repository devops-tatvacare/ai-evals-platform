import type { AppId } from '@/types';
import type { RunDetailAppEntry } from './types';
import { kairaRunDetailEntry } from './kairaEntry';
import { insideSalesRunDetailEntry } from './insideSalesEntry';
import { voiceRxRunDetailEntry } from './voiceRxEntry';

/**
 * Per-app run-detail entries, consumed by the single `RunDetailPage`. Adding an
 * app to the run-detail surface means registering an entry here — never forking
 * a new page component.
 */
export const RUN_DETAIL_REGISTRY: Record<AppId, RunDetailAppEntry> = {
  'kaira-bot': kairaRunDetailEntry,
  'inside-sales': insideSalesRunDetailEntry,
  'voice-rx': voiceRxRunDetailEntry,
};
