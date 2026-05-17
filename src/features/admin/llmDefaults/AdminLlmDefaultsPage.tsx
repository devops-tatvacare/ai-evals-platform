import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';

import {
  Alert,
  Button,
  Combobox,
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
import { useLlmModels } from '@/services/api/llmModelsQueries';
import type {
  CallSiteDefault,
  CallSiteSpec,
} from '@/services/api/llmCallSiteDefaultsApi';
import type {
  LlmProvider,
  TenantCredential,
} from '@/services/api/llmCredentialsApi';
import { useAuthStore } from '@/stores/authStore';

type Scope = 'tenant' | 'platform';

/**
 * Defaults matrix. Rows = every call site from the registry. Columns =
 * providers for which the current tenant has at least one credential. Each
 * cell carries a credential picker (when multiple credentials exist for the
 * provider) and a model picker fed by `/api/llm/models` (capability-filtered).
 *
 * Platform-scope toggle is gated by `platform:edit`; when on, the page hits
 * the platform routes and renders a persistent banner.
 */
export function AdminLlmDefaultsPage() {
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canEditPlatform = permissions.includes('platform:edit');
  const [scope, setScope] = useState<Scope>('tenant');

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

  const providersWithCreds = useMemo<LlmProvider[]>(() => {
    const set = new Set<LlmProvider>();
    for (const c of credentials) if (c.isEnabled) set.add(c.provider);
    return Array.from(set).sort();
  }, [credentials]);

  const activeDefaults: CallSiteDefault[] =
    scope === 'platform' ? platformDefaults : tenantDefaults;
  const defaultsByKey = useMemo(() => {
    const map = new Map<string, CallSiteDefault>();
    for (const d of activeDefaults) {
      map.set(`${d.callSite}::${d.provider}`, d);
    }
    return map;
  }, [activeDefaults]);

  const platformByCallSite = useMemo(() => {
    const map = new Map<string, CallSiteDefault>();
    for (const d of platformDefaults) map.set(d.callSite, d);
    return map;
  }, [platformDefaults]);

  if (registryLoading || credsLoading) {
    return <LoadingState message="Loading defaults…" />;
  }

  return (
    <PageSurface
      icon={Sparkles}
      title={scope === 'platform' ? 'Platform LLM Defaults' : 'LLM Defaults'}
      subtitle={
        scope === 'platform'
          ? 'Edit defaults that apply to every tenant unless they override.'
          : "Pick which credential + model resolves each call site for this tenant. Empty cells fall back to the platform default."
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

      {providersWithCreds.length === 0 ? (
        <Alert variant="info">
          No LLM credentials configured for this tenant.{' '}
          <a className="underline" href="/admin/ai-settings">
            Add one in AI Settings
          </a>{' '}
          to start setting defaults.
        </Alert>
      ) : (
        <DefaultsMatrix
          registry={registry}
          credentials={credentials}
          providers={providersWithCreds}
          defaultsByKey={defaultsByKey}
          platformByCallSite={platformByCallSite}
          scope={scope}
          onSave={async (callSite, body) => {
            try {
              if (scope === 'platform') {
                await upsertPlatform.mutateAsync({ callSite, body });
              } else {
                await upsertTenant.mutateAsync({ callSite, body });
              }
              notificationService.success('Default saved');
            } catch (err) {
              notificationService.error(
                err instanceof Error ? err.message : 'Failed to save default',
              );
            }
          }}
          onClear={async (callSite) => {
            if (scope === 'platform') return; // platform rows aren't clearable
            try {
              await deleteTenant.mutateAsync(callSite);
              notificationService.success(
                'Override cleared — falls back to platform default',
              );
            } catch (err) {
              notificationService.error(
                err instanceof Error ? err.message : 'Failed to clear default',
              );
            }
          }}
        />
      )}
    </PageSurface>
  );
}

interface MatrixProps {
  registry: CallSiteSpec[];
  credentials: TenantCredential[];
  providers: LlmProvider[];
  defaultsByKey: Map<string, CallSiteDefault>;
  platformByCallSite: Map<string, CallSiteDefault>;
  scope: Scope;
  onSave: (
    callSite: string,
    body: {
      provider: string;
      credentialName: string;
      modelOrDeployment: string;
    },
  ) => Promise<void>;
  onClear: (callSite: string) => Promise<void>;
}

function DefaultsMatrix({
  registry,
  credentials,
  providers,
  defaultsByKey,
  platformByCallSite,
  scope,
  onSave,
  onClear,
}: MatrixProps) {
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
            <th className="px-3 py-2 text-left text-[12px] font-semibold text-[var(--text-secondary)]">
              Call site
            </th>
            {providers.map((p) => (
              <th
                key={p}
                className="px-3 py-2 text-left text-[12px] font-semibold text-[var(--text-secondary)]"
              >
                {LLM_PROVIDER_LABELS[p]}
              </th>
            ))}
            {scope === 'tenant' && (
              <th className="px-3 py-2 text-left text-[12px] font-semibold text-[var(--text-secondary)]" />
            )}
          </tr>
        </thead>
        <tbody>
          {registry.map((spec) => (
            <tr
              key={spec.id}
              className="border-b border-[var(--border-subtle)] last:border-b-0"
            >
              <td className="px-3 py-3 align-top">
                <div className="font-medium text-[var(--text-primary)]">
                  {spec.id}
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {spec.description}
                </div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                  needs:{' '}
                  {spec.requiredCapabilities.length
                    ? spec.requiredCapabilities.join(', ')
                    : '(any)'}
                </div>
              </td>
              {providers.map((p) => (
                <td key={p} className="px-3 py-3 align-top">
                  <DefaultsCell
                    callSite={spec.id}
                    provider={p}
                    credentials={credentials.filter(
                      (c) => c.provider === p && c.isEnabled,
                    )}
                    existing={defaultsByKey.get(`${spec.id}::${p}`) ?? null}
                    platformFallback={platformByCallSite.get(spec.id) ?? null}
                    scope={scope}
                    onSave={onSave}
                  />
                </td>
              ))}
              {scope === 'tenant' && (
                <td className="px-3 py-3 align-top">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onClear(spec.id)}
                  >
                    Clear
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface CellProps {
  callSite: string;
  provider: LlmProvider;
  credentials: TenantCredential[];
  existing: CallSiteDefault | null;
  platformFallback: CallSiteDefault | null;
  scope: Scope;
  onSave: MatrixProps['onSave'];
}

function DefaultsCell({
  callSite,
  provider,
  credentials,
  existing,
  platformFallback,
  scope,
  onSave,
}: CellProps) {
  // Local edit state seeded from server value; explicit Save commits.
  const [credentialName, setCredentialName] = useState<string>(
    existing?.credentialName ?? credentials[0]?.name ?? '',
  );
  const [model, setModel] = useState<string>(existing?.modelOrDeployment ?? '');

  const credentialId =
    credentials.find((c) => c.name === credentialName)?.id ?? null;
  const { data: modelOptions = [], isLoading: modelsLoading } = useLlmModels(
    callSite,
    credentialId,
  );

  if (credentials.length === 0) {
    return (
      <span className="text-[12px] text-[var(--text-muted)]">
        no credential
      </span>
    );
  }

  const credentialOptions = credentials.map((c) => ({
    value: c.name,
    label: c.name,
  }));
  const modelComboOptions = modelOptions.map((m) => ({
    value: m.modelOrDeployment,
    label: m.displayName || m.modelOrDeployment,
  }));

  const isDirty =
    !existing ||
    existing.credentialName !== credentialName ||
    existing.modelOrDeployment !== model;

  const showPlatformHint =
    scope === 'tenant' && !existing && platformFallback?.provider === provider;

  return (
    <div className="flex min-w-[260px] flex-col gap-1.5">
      {credentials.length > 1 ? (
        <Combobox
          value={credentialName}
          options={credentialOptions}
          placeholder="Credential"
          size="sm"
          onChange={(v) => {
            setCredentialName(v);
            setModel('');
          }}
        />
      ) : (
        <div className="text-[11px] text-[var(--text-muted)]">
          credential: {credentials[0].name}
        </div>
      )}
      <Combobox
        value={model}
        options={modelComboOptions}
        placeholder={
          modelsLoading
            ? 'Loading…'
            : modelComboOptions.length === 0
              ? 'No models'
              : 'Pick model'
        }
        size="sm"
        disabled={modelComboOptions.length === 0}
        onChange={setModel}
      />
      {showPlatformHint && (
        <p className="text-[10px] text-[var(--text-muted)]">
          falls back to platform: {platformFallback?.provider} /{' '}
          {platformFallback?.modelOrDeployment}
        </p>
      )}
      {isDirty && model && (
        <Button
          size="sm"
          variant="primary"
          onClick={() =>
            onSave(callSite, {
              provider,
              credentialName,
              modelOrDeployment: model,
            })
          }
        >
          Save
        </Button>
      )}
    </div>
  );
}
