import { useMemo, useState } from 'react';
import { MessageSquare, Mic, BarChart3, Sparkles, SlidersHorizontal, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import {
  Alert,
  Button,
  CapabilityChips,
  EmptyState,
  LLMProviderLogo,
  LlmModelSelect,
  LoadingState,
  PageSurface,
  Switch,
} from '@/components/ui';
import { LLM_PROVIDER_LABELS } from '@/constants/llmProviders';
import { notificationService } from '@/services/notifications';
import { useAllTenantCredentials } from '@/services/api/llmCredentialsQueries';
import {
  useCallSiteRegistry,
  useDeleteTenantDefault,
  usePlatformCallSiteDefaults,
  useTenantCallSiteDefaults,
  useUpsertPlatformDefault,
  useUpsertTenantDefault,
} from '@/services/api/llmCallSiteDefaultsQueries';
import type {
  CallSiteDefault,
  CallSiteSpec,
} from '@/services/api/llmCallSiteDefaultsApi';
import type { CapabilityTag } from '@/services/api/llmModelsApi';
import type { LlmProvider } from '@/services/api/llmCredentialsApi';
import { useAuthStore } from '@/stores/authStore';

import { useDirtyDefaults, type UseDirtyDefaultsApi } from './useDirtyDefaults';

type Scope = 'tenant' | 'platform';

interface GroupSpec {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  reference: string;
  siteIds: string[];
}

// Capability-driven grouping. Order matters — most-used first.
const GROUPS: GroupSpec[] = [
  {
    id: 'conversational',
    label: 'Conversational',
    icon: MessageSquare,
    description: 'Chat surfaces — plain text, multimodal, reasoning.',
    reference: 'Evaluation runner chat replies.',
    siteIds: ['chat_text', 'chat_vision', 'chat_reasoning'],
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: Mic,
    description: 'Speech-to-text and text-to-speech.',
    reference: 'Audio evaluation transcription · text-to-speech.',
    siteIds: ['audio_transcription', 'audio_synthesis'],
  },
  {
    id: 'analytics',
    label: 'Analytics & reporting',
    icon: BarChart3,
    description: 'Sherlock supervisor / specialist and report generation.',
    reference: 'Sherlock analytics chat · report generation.',
    siteIds: ['analytics_supervisor', 'analytics_specialist', 'report_generation'],
  },
  {
    id: 'authoring',
    label: 'Authoring & extraction',
    icon: Sparkles,
    description: 'Rubric drafting, structured extraction, and on-demand assist.',
    reference: 'generate-evaluator-draft · backfill-lead-signals · assist endpoints.',
    siteIds: ['assist_prompt_or_schema', 'evaluator_draft', 'lead_signal_extraction'],
  },
];

export function AdminLlmDefaultsPage() {
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canEditPlatform = permissions.includes('platform:edit');
  const [scope, setScope] = useState<Scope>('tenant');
  const [selectedGroupId, setSelectedGroupId] = useState<string>(GROUPS[0].id);

  const { data: registry = [], isLoading: registryLoading } =
    useCallSiteRegistry();
  const { credentials, isLoading: credsLoading } = useAllTenantCredentials();
  const { data: tenantDefaults = [] } = useTenantCallSiteDefaults();
  const { data: platformDefaults = [] } = usePlatformCallSiteDefaults(
    scope === 'platform' && canEditPlatform,
  );

  const upsertTenant = useUpsertTenantDefault();
  const deleteTenant = useDeleteTenantDefault();
  const upsertPlatform = useUpsertPlatformDefault();

  const activeDefaults: CallSiteDefault[] =
    scope === 'platform' ? platformDefaults : tenantDefaults;

  // Page-level dirty/save state. Lives here so switching capability groups in
  // the rail does NOT unmount in-flight edits.
  const dirty = useDirtyDefaults({
    defaults: activeDefaults,
    credentials,
  });

  const defaultByCallSite = useMemo(() => {
    const map = new Map<string, CallSiteDefault>();
    for (const d of activeDefaults) map.set(d.callSite, d);
    return map;
  }, [activeDefaults]);

  const platformByCallSite = useMemo(() => {
    const map = new Map<string, CallSiteDefault>();
    for (const d of platformDefaults) map.set(d.callSite, d);
    return map;
  }, [platformDefaults]);

  const groupsWithRows = useMemo(() => {
    const known = new Set(GROUPS.flatMap((g) => g.siteIds));
    const enriched = GROUPS.map((g) => ({
      ...g,
      specs: g.siteIds
        .map((id) => registry.find((s) => s.id === id))
        .filter((s): s is CallSiteSpec => !!s),
    }));
    const orphans = registry.filter((s) => !known.has(s.id));
    if (orphans.length > 0) {
      enriched.push({
        id: 'other',
        label: 'Other',
        icon: SlidersHorizontal,
        description: 'Call sites not yet placed into a capability group.',
        reference: 'Ungrouped call sites.',
        siteIds: orphans.map((s) => s.id),
        specs: orphans,
      });
    }
    return enriched;
  }, [registry]);

  const enabledCount = useMemo(
    () => credentials.filter((c) => c.isEnabled).length,
    [credentials],
  );

  // All hooks declared BEFORE any early-return so React's rules-of-hooks
  // never see a varying call count between renders. Loading state moved to
  // the render branch below.
  const [savingAll, setSavingAll] = useState(false);

  const handleClear = async (callSite: string) => {
    if (scope === 'platform') return;
    try {
      await deleteTenant.mutateAsync(callSite);
      notificationService.success(
        `Override cleared — ${callSite} falls back to platform default`,
      );
    } catch (err) {
      notificationService.error(
        err instanceof Error ? err.message : 'Failed to clear default',
      );
    }
  };

  const handleSaveAll = async () => {
    setSavingAll(true);
    try {
      const result = await dirty.commitAll(async (callSite, body) => {
        if (scope === 'platform') {
          await upsertPlatform.mutateAsync({ callSite, body });
        } else {
          await upsertTenant.mutateAsync({ callSite, body });
        }
      });
      if (result.failed.length === 0) {
        notificationService.success(
          `Saved ${result.saved.length} ${result.saved.length === 1 ? 'change' : 'changes'}`,
        );
      } else if (result.saved.length === 0) {
        notificationService.error(
          `Failed to save ${result.failed.length} ${result.failed.length === 1 ? 'change' : 'changes'} — inline errors below`,
        );
      } else {
        notificationService.warning(
          `Saved ${result.saved.length}, ${result.failed.length} failed — inline errors below`,
        );
      }
    } finally {
      setSavingAll(false);
    }
  };

  // Nav-away guard for in-app navigation would normally use react-router's
  // ``useBlocker``, but that requires a data router (createBrowserRouter).
  // The app currently uses ``<BrowserRouter>``, so useBlocker throws at
  // runtime. ``beforeunload`` inside ``useDirtyDefaults`` handles tab close
  // and reload; in-app navigation with unsaved changes is the gap until the
  // router upgrade. The dirty-count badge in the page header + sidebar group
  // make the unsaved state visible at all times to soften the surprise.

  if (registryLoading || credsLoading) {
    return <LoadingState message="Loading defaults…" />;
  }

  const selectedGroup =
    groupsWithRows.find((g) => g.id === selectedGroupId) ?? groupsWithRows[0];

  return (
    <PageSurface
      icon={SlidersHorizontal}
      title={scope === 'platform' ? 'Platform LLM Defaults' : 'LLM Defaults'}
      subtitle={
        scope === 'platform'
          ? 'Edit defaults that apply to every tenant unless they override.'
          : 'One default model per call site for this tenant. Empty rows fall back to the platform default.'
      }
      actions={
        dirty.dirtyCount > 0 ? (
          <Button
            variant="primary"
            onClick={handleSaveAll}
            disabled={savingAll}
          >
            {savingAll
              ? 'Saving…'
              : `Save ${dirty.dirtyCount} ${dirty.dirtyCount === 1 ? 'change' : 'changes'}`}
          </Button>
        ) : undefined
      }
    >
      {scope === 'platform' && (
        <div className="mb-4">
          <Alert variant="warning">
            You are editing platform-wide defaults. These apply to every tenant
            unless that tenant has set its own override.
          </Alert>
        </div>
      )}

      {canEditPlatform && (
        <div className="mb-4 flex items-center justify-end gap-2">
          <label className="text-[12px] text-[var(--text-secondary)]">
            Platform scope
          </label>
          <Switch
            checked={scope === 'platform'}
            onCheckedChange={(on: boolean) =>
              setScope(on ? 'platform' : 'tenant')
            }
          />
        </div>
      )}

      {enabledCount === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={Sparkles}
            title="No LLM credentials configured"
            description="Add a provider credential before setting call-site defaults."
            action={{
              label: 'Open Model Providers',
              onClick: () => {
                window.location.href = '/admin/llm/providers';
              },
            }}
          />
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-0 pt-4">
          <div className="flex min-h-0 flex-1 gap-0">
            <aside className="w-64 shrink-0 overflow-y-auto pr-5">
              <GroupRail
                groups={groupsWithRows}
                selected={selectedGroupId}
                onSelect={setSelectedGroupId}
                overrideCount={(siteIds) =>
                  siteIds.filter((id) => defaultByCallSite.has(id)).length
                }
                dirtyCountIn={(siteIds) =>
                  siteIds.filter((id) => dirty.isDirty(id)).length
                }
              />
            </aside>
            <section className="flex min-w-0 flex-1 flex-col gap-3 border-l border-[var(--border-subtle)] pl-5">
              <header>
                <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                  {selectedGroup.label}
                </h2>
                <p className="text-[12px] text-[var(--text-muted)]">
                  {selectedGroup.description}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                  <span className="text-[var(--text-secondary)]">Used by</span>{' '}
                  {selectedGroup.reference}
                </p>
              </header>
              {selectedGroup.specs.length === 0 ? (
                <div className="flex flex-1 items-center justify-center">
                  <EmptyState
                    icon={selectedGroup.icon}
                    title="No call sites in this group"
                    description="Registry returned no entries for this capability group."
                  />
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                  {selectedGroup.specs.map((spec) => (
                    <CallSiteRow
                      key={spec.id}
                      spec={spec}
                      existing={defaultByCallSite.get(spec.id) ?? null}
                      platformFallback={platformByCallSite.get(spec.id) ?? null}
                      scope={scope}
                      dirty={dirty}
                      onClear={handleClear}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </PageSurface>
  );
}

interface RailProps {
  groups: Array<GroupSpec & { specs: CallSiteSpec[] }>;
  selected: string;
  onSelect: (id: string) => void;
  overrideCount: (siteIds: string[]) => number;
  dirtyCountIn: (siteIds: string[]) => number;
}

function GroupRail({
  groups,
  selected,
  onSelect,
  overrideCount,
  dirtyCountIn,
}: RailProps) {
  return (
    <nav
      className="flex w-full flex-col gap-1.5"
      aria-label="Capability group selector"
    >
      {groups.map((g) => {
        const Icon = g.icon;
        const isSelected = selected === g.id;
        const total = g.specs.length;
        const overrides = overrideCount(g.specs.map((s) => s.id));
        const dirtyHere = dirtyCountIn(g.specs.map((s) => s.id));
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => onSelect(g.id)}
            aria-pressed={isSelected}
            className={
              isSelected
                ? 'flex items-center justify-between gap-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] px-3 py-2 text-left transition-colors'
                : 'flex items-center justify-between gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-left transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-tertiary)]'
            }
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {g.label}
                </span>
                <span className="truncate text-[11px] text-[var(--text-muted)]">
                  {overrides} of {total} set
                  {dirtyHere > 0 ? ` · ${dirtyHere} unsaved` : ''}
                </span>
              </div>
            </div>
            {dirtyHere > 0 && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]"
                aria-label={`${dirtyHere} unsaved`}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}

interface CallSiteRowProps {
  spec: CallSiteSpec;
  existing: CallSiteDefault | null;
  platformFallback: CallSiteDefault | null;
  scope: Scope;
  dirty: UseDirtyDefaultsApi;
  onClear: (callSite: string) => Promise<void>;
}

function CallSiteRow({
  spec,
  existing,
  platformFallback,
  scope,
  dirty,
  onClear,
}: CallSiteRowProps) {
  const pick = dirty.getPick(spec.id);
  const rowDirty = dirty.isDirty(spec.id);
  const error = dirty.getError(spec.id);

  return (
    <div className="px-4 py-3">
      {/* Identity flexes; the picker cluster + clear slot are fixed-width and
          right-anchored so every row's dropdowns line up. The clear slot is
          always reserved so its appearing/disappearing never reflows the
          picker. */}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
              {spec.id}
            </h3>
            <CapabilityChips
              tags={spec.requiredCapabilities as CapabilityTag[]}
            />
            {rowDirty && (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]"
                aria-label="Unsaved"
              />
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            {spec.description}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            <span className="text-[var(--text-secondary)]">Used by</span>{' '}
            {spec.reference}
          </p>
        </div>

        <div className="w-[480px] shrink-0">
          <LlmModelSelect
            callSite={spec.id}
            value={pick}
            onChange={(next) => dirty.setPick(spec.id, next)}
            noAutoDefault
            compact
            layout="inline"
          />
          {error && (
            <p className="mt-1.5 text-[11px] text-[var(--color-error)]">
              {error}
            </p>
          )}
          {!error && scope === 'tenant' && !existing && platformFallback && (
            <div className="mt-1.5">
              <FallbackHint platform={platformFallback} />
            </div>
          )}
        </div>

        <div className="flex w-7 shrink-0 items-center justify-end">
          {scope === 'tenant' && existing && (
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              iconOnly
              onClick={() => onClear(spec.id)}
              aria-label={`Clear override for ${spec.id}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FallbackHint({ platform }: { platform: CallSiteDefault }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
      <span>Falls back to platform:</span>
      <LLMProviderLogo
        provider={platform.provider as LlmProvider}
        size={14}
      />
      <span className="text-[var(--text-secondary)]">
        {LLM_PROVIDER_LABELS[platform.provider as LlmProvider]} /{' '}
        {platform.modelOrDeployment}
      </span>
    </div>
  );
}
