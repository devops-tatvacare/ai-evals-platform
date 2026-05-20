import { useEffect, useMemo, useState } from 'react';

import type { LlmModelSelectValue } from '@/components/ui';
import type { CallSiteDefault } from '@/services/api/llmCallSiteDefaultsApi';
import type { LlmProvider, TenantCredential } from '@/services/api/llmCredentialsApi';

/**
 * Page-level dirty state for the LLM Defaults matrix.
 *
 * Lives at the page (not per-row) so that switching capability groups in the
 * rail does NOT unmount in-flight picks. Mirrors the orchestration-builder
 * lifecycle invariant (CLAUDE.md): state is derived from server data; the
 * "dirty" judgment is a function of (committed value, current pick), never a
 * flag set by a button click.
 *
 * Per-row save flow:
 *   1. row reads `getPick(callSite)` — returns the user's local pick if any,
 *      otherwise the server-side `existing` mapped back to a picker value.
 *   2. row calls `setPick(callSite, next)` on every picker change.
 *   3. row reads `isDirty(callSite)` to know whether to show Save.
 *   4. row calls `commit(callSite)` to fire the mutation. While in flight,
 *      `isSaving(callSite)` is true; on failure, `getError(callSite)` returns
 *      the message; on success, `existing` updates and the pick is cleared
 *      from the map so the row re-derives from server data.
 */
export interface UseDirtyDefaultsApi {
  /** Per-call-site pick the user is editing. Falls back to server value. */
  getPick: (callSite: string) => LlmModelSelectValue | null;
  setPick: (callSite: string, next: LlmModelSelectValue | null) => void;
  isDirty: (callSite: string) => boolean;
  isSaving: (callSite: string) => boolean;
  getError: (callSite: string) => string | null;
  commit: (
    callSite: string,
    save: (body: {
      provider: string;
      credentialName: string;
      modelOrDeployment: string;
    }) => Promise<void>,
  ) => Promise<void>;
  /** Number of dirty rows across all groups. */
  dirtyCount: number;
  /** Discard every uncommitted edit. */
  discardAll: () => void;
  /** Commit every dirty row sequentially. Resolves with the per-row outcome map. */
  commitAll: (
    save: (
      callSite: string,
      body: {
        provider: string;
        credentialName: string;
        modelOrDeployment: string;
      },
    ) => Promise<void>,
  ) => Promise<{ saved: string[]; failed: string[] }>;
}

export function useDirtyDefaults({
  defaults,
  credentials,
}: {
  defaults: CallSiteDefault[];
  credentials: TenantCredential[];
}): UseDirtyDefaultsApi {
  // The user's overrides. Keyed by callSite. Absent => derive from `defaults`.
  const [picks, setPicks] = useState<
    Record<string, LlmModelSelectValue | null>
  >({});
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  // Server snapshot mapped to a picker value (provider+credentialName resolved
  // back to a credentialId by joining against the credentials list).
  const serverPickByCallSite = useMemo(() => {
    const map = new Map<string, LlmModelSelectValue | null>();
    for (const d of defaults) {
      const match = credentials.find(
        (c) =>
          c.provider === (d.provider as LlmProvider) &&
          c.name === d.credentialName,
      );
      if (!match) {
        map.set(d.callSite, null);
        continue;
      }
      map.set(d.callSite, {
        credentialId: match.id,
        provider: match.provider,
        credentialName: match.name,
        model: d.modelOrDeployment,
      });
    }
    return map;
  }, [defaults, credentials]);

  // Drop in-flight picks that now match server (e.g. another tab saved).
  useEffect(() => {
    setPicks((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const callSite of Object.keys(prev)) {
        const local = prev[callSite];
        const server = serverPickByCallSite.get(callSite) ?? null;
        if (pickEquals(local, server)) {
          delete next[callSite];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [serverPickByCallSite]);

  const getPick = (callSite: string): LlmModelSelectValue | null => {
    if (callSite in picks) return picks[callSite];
    return serverPickByCallSite.get(callSite) ?? null;
  };

  const setPick = (callSite: string, next: LlmModelSelectValue | null) => {
    setPicks((prev) => ({ ...prev, [callSite]: next }));
    setErrors((prev) =>
      prev[callSite] ? { ...prev, [callSite]: null } : prev,
    );
  };

  const isDirty = (callSite: string): boolean => {
    if (!(callSite in picks)) return false;
    const local = picks[callSite];
    if (!local || !local.model) return false;
    const server = serverPickByCallSite.get(callSite) ?? null;
    return !pickEquals(local, server);
  };

  const isSaving = (callSite: string) => saving.has(callSite);
  const getError = (callSite: string) => errors[callSite] ?? null;

  const commit: UseDirtyDefaultsApi['commit'] = async (callSite, save) => {
    const pick = picks[callSite];
    if (!pick || !pick.model) return;
    setSaving((prev) => {
      const next = new Set(prev);
      next.add(callSite);
      return next;
    });
    setErrors((prev) => ({ ...prev, [callSite]: null }));
    try {
      await save({
        provider: pick.provider,
        credentialName: pick.credentialName,
        modelOrDeployment: pick.model,
      });
      // Don't drop the override here — wait for `serverPickByCallSite` to
      // refresh from TanStack invalidation; the effect above clears it once
      // local matches server.
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setErrors((prev) => ({ ...prev, [callSite]: msg }));
      throw err;
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(callSite);
        return next;
      });
    }
  };

  const dirtyCount = useMemo(() => {
    let n = 0;
    for (const callSite of Object.keys(picks)) {
      if (isDirty(callSite)) n += 1;
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, serverPickByCallSite]);

  const discardAll = () => {
    setPicks({});
    setErrors({});
  };

  const commitAll: UseDirtyDefaultsApi['commitAll'] = async (save) => {
    const saved: string[] = [];
    const failed: string[] = [];
    // Snapshot of currently-dirty call sites — we iterate over the snapshot
    // so concurrent setPick calls don't mutate the iteration target.
    const dirtyCallSites = Object.keys(picks).filter((cs) => {
      const local = picks[cs];
      if (!local || !local.model) return false;
      const server = serverPickByCallSite.get(cs) ?? null;
      return !pickEquals(local, server);
    });
    for (const callSite of dirtyCallSites) {
      try {
        await commit(callSite, (body) => save(callSite, body));
        saved.push(callSite);
      } catch {
        // commit() already stored the per-row error; just track that this
        // one failed so the caller can show "saved N, failed M".
        failed.push(callSite);
      }
    }
    return { saved, failed };
  };

  // Warn before unload while anything is dirty.
  useEffect(() => {
    if (dirtyCount === 0) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      // preventDefault() alone is what current browsers honour; legacy
      // returnValue intentionally untouched (deprecated and unnecessary).
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirtyCount]);

  return {
    getPick,
    setPick,
    isDirty,
    isSaving,
    getError,
    commit,
    dirtyCount,
    discardAll,
    commitAll,
  };
}

function pickEquals(
  a: LlmModelSelectValue | null,
  b: LlmModelSelectValue | null,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    a.provider === b.provider &&
    a.credentialName === b.credentialName &&
    a.model === b.model
  );
}
