/**
 * Quick-action registry — kind → descriptor map.
 *
 * Three generic primitive kinds, full stop:
 *
 *   • ``openModal``           — config: ``{modalId: string}``
 *   • ``triggerImperative``   — config: ``{triggerKey: string}``
 *   • ``navigateTo``          — config: ``{path: string}``
 *
 * App- and tenant-specific behavior is expressed by COMPOSING these
 * primitives in the app config (label / icon / config payload all live on
 * the spec). New tenants and new apps add menu items by writing config
 * rows — never by adding code here. New BEHAVIORS (e.g. "kaira.createSession")
 * are exposed by registering a uiStore imperative trigger from the relevant
 * feature module; the registry does not need to know about them.
 *
 * If you find yourself writing a 4th kind here, you're almost certainly
 * smuggling app coupling into the registry — push the work into the
 * trigger-registration / modal layer instead.
 */
import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  useAppSettingsStore,
  useAppStore,
  useGlobalSettingsStore,
  useUIStore,
} from '@/stores';
import { useProviderConfigs } from '@/services/api/aiSettingsQueries';
import type { QuickActionSpec } from '@/types';
import { evaluateActionAvailability } from '@/utils/actionAvailability';

import type { QuickActionDescriptor, QuickActionRuntime } from './types';

// ── Per-spec availability ────────────────────────────────────────────────────
// Centralised so every kind reuses the same gate-evaluation logic. Every
// spec is wrapped in this hook before being handed to the kind-specific
// runtime hook below.
function useSpecAvailability(spec: QuickActionSpec) {
  const appId = useAppStore((s) => s.currentApp);
  const appSettings = useAppSettingsStore((s) => s.settings[appId]);
  const globalSettings = useGlobalSettingsStore();
  // BYOK: per-user LLM credentials no longer exist. We expose a single
  // derived flag (`hasConfiguredLlmProvider`) that any quick-action spec
  // can require via `{ source: 'tenantProviders', key: 'hasConfiguredLlmProvider' }`.
  const { data: providerConfigs = [] } = useProviderConfigs();
  const tenantProviders = useMemo(
    () => ({
      hasConfiguredLlmProvider: providerConfigs.some(
        (c) => c.isEnabled && c.validationStatus === 'ok',
      ),
    }),
    [providerConfigs],
  );
  return useMemo(
    () =>
      evaluateActionAvailability({
        appId,
        action: { requirements: spec.requirements ?? [] },
        sources: { appSettings, globalSettings, tenantProviders },
      }),
    [appId, appSettings, globalSettings, tenantProviders, spec.requirements],
  );
}

// ── Kind: openModal ──────────────────────────────────────────────────────────
function useOpenModalRuntime(spec: QuickActionSpec): QuickActionRuntime {
  const openModal = useUIStore((s) => s.openModal);
  const availability = useSpecAvailability(spec);
  const modalId = typeof spec.config?.modalId === 'string' ? spec.config.modalId : '';
  const onSelect = useCallback(() => {
    if (!modalId) {
      console.warn(`quickAction openModal spec ${spec.id} has no modalId`);
      return;
    }
    openModal(modalId);
  }, [modalId, openModal, spec.id]);
  return {
    onSelect,
    disabled: availability.disabled || !modalId,
    isLoading: false,
    blockers: availability.blockers,
  };
}

// ── Kind: triggerImperative ──────────────────────────────────────────────────
// Reads a trigger registered by long-lived chrome (MainLayout, feature
// modules) into uiStore.imperativeTriggers. The registry has no knowledge of
// what the trigger does — only that it exists. New behaviors are added by
// registering a new trigger from the feature module that owns it.
function useTriggerImperativeRuntime(spec: QuickActionSpec): QuickActionRuntime {
  const triggerKey = typeof spec.config?.triggerKey === 'string' ? spec.config.triggerKey : '';
  const invokeTrigger = useUIStore((s) => s.invokeTrigger);
  const triggerRegistered = useUIStore((s) =>
    triggerKey ? Boolean(s.imperativeTriggers[triggerKey]) : false,
  );
  // Per-trigger loading state lives on the feature module's own store
  // (e.g. chatStore.isCreatingSession for the kaira create-session trigger).
  // We expose nothing here — feature modules can mirror their loading flag
  // into uiStore later if it's worth surfacing in the menu row.
  const availability = useSpecAvailability(spec);

  const onSelect = useCallback(() => {
    if (!triggerKey) {
      console.warn(`quickAction triggerImperative spec ${spec.id} has no triggerKey`);
      return;
    }
    invokeTrigger(triggerKey);
  }, [invokeTrigger, spec.id, triggerKey]);

  return {
    onSelect,
    disabled: availability.disabled || !triggerKey || !triggerRegistered,
    isLoading: false,
    blockers: availability.blockers,
  };
}

// ── Kind: navigateTo ─────────────────────────────────────────────────────────
function useNavigateToRuntime(spec: QuickActionSpec): QuickActionRuntime {
  const navigate = useNavigate();
  const path = typeof spec.config?.path === 'string' ? spec.config.path : '';
  const availability = useSpecAvailability(spec);
  const onSelect = useCallback(() => {
    if (!path) {
      console.warn(`quickAction navigateTo spec ${spec.id} has no path`);
      return;
    }
    navigate(path);
  }, [navigate, path, spec.id]);
  return {
    onSelect,
    disabled: availability.disabled || !path,
    isLoading: false,
    blockers: availability.blockers,
  };
}

export const QUICK_ACTION_REGISTRY: Record<QuickActionSpec['kind'], QuickActionDescriptor> = {
  openModal: { useResolve: useOpenModalRuntime },
  triggerImperative: { useResolve: useTriggerImperativeRuntime },
  navigateTo: { useResolve: useNavigateToRuntime },
};
