import { useEffect, useId, useMemo, useState } from 'react';
import { X } from 'lucide-react';

import {
  Button,
  FileDropZone,
  Input,
  RightSlideOverShell,
  Switch,
} from '@/components/ui';
import { LLMProviderLogo } from '@/components/ui/LLMProviderLogo';
import { LLM_PROVIDER_LABELS } from '@/constants/llmProviders';
import { notificationService } from '@/services/notifications';
import {
  useCreateCredential,
  useUpdateCredential,
} from '@/services/api/llmCredentialsQueries';
import type {
  CredentialCreateBody,
  CredentialUpdateBody,
  LlmProvider,
  TenantCredential,
} from '@/services/api/llmCredentialsApi';

interface CredentialFormSlideOverProps {
  open: boolean;
  onClose: () => void;
  provider: LlmProvider;
  /** Existing credential when editing; null when creating. */
  credential: TenantCredential | null;
}

interface FormState {
  name: string;
  isEnabled: boolean;
  // Secret fields — per-provider:
  apiKey: string;
  // Azure
  endpoint: string;
  apiVersion: string;
  // Vertex
  serviceAccountJson: string;
  // Bedrock
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  defaultRegion: string;
  // OpenAI / Anthropic
  baseUrl: string;
}

const DEFAULT_AZURE_API_VERSION = '2025-04-01-preview';
const DEFAULT_BEDROCK_REGION = 'us-east-1';

function blankForm(provider: LlmProvider): FormState {
  return {
    name: 'default',
    isEnabled: true,
    apiKey: '',
    endpoint: '',
    apiVersion:
      provider === 'azure_openai' ? DEFAULT_AZURE_API_VERSION : '',
    serviceAccountJson: '',
    accessKeyId: '',
    secretAccessKey: '',
    sessionToken: '',
    defaultRegion: provider === 'bedrock' ? DEFAULT_BEDROCK_REGION : '',
    baseUrl: '',
  };
}

function hydrateForm(
  provider: LlmProvider,
  credential: TenantCredential | null,
): FormState {
  if (!credential) return blankForm(provider);
  const extra = credential.extraConfig ?? {};
  return {
    name: credential.name,
    isEnabled: credential.isEnabled,
    apiKey: '',
    endpoint: (extra.base_url as string | undefined) ?? '',
    apiVersion:
      (extra.api_version as string | undefined) ??
      (provider === 'azure_openai' ? DEFAULT_AZURE_API_VERSION : ''),
    serviceAccountJson: '',
    accessKeyId: '',
    secretAccessKey: '',
    sessionToken: '',
    defaultRegion:
      (extra.default_region as string | undefined) ??
      (provider === 'bedrock' ? DEFAULT_BEDROCK_REGION : ''),
    baseUrl: (extra.base_url as string | undefined) ?? '',
  };
}

/**
 * Build the request body for create vs update. On update, blank secret keys
 * preserve the stored value — mirrors the orchestration-connections precedent.
 * On create, every required field must be present.
 */
function buildBody(
  provider: LlmProvider,
  form: FormState,
  isCreate: boolean,
): { body: CredentialCreateBody | CredentialUpdateBody; error?: string } {
  const secret: Record<string, string> = {};
  const extraConfig: Record<string, unknown> = {};

  if (provider === 'openai' || provider === 'anthropic' || provider === 'gemini') {
    if (isCreate && !form.apiKey.trim()) {
      return { body: {}, error: 'API key is required' };
    }
    if (form.apiKey.trim()) secret.api_key = form.apiKey.trim();
    if (provider === 'openai' && form.baseUrl.trim()) {
      extraConfig.base_url = form.baseUrl.trim();
    }
  } else if (provider === 'azure_openai') {
    if (isCreate && !form.apiKey.trim()) {
      return { body: {}, error: 'API key is required' };
    }
    if (!form.endpoint.trim()) {
      return { body: {}, error: 'Azure endpoint is required' };
    }
    if (form.apiKey.trim()) secret.api_key = form.apiKey.trim();
    extraConfig.base_url = form.endpoint.trim();
    extraConfig.api_version =
      form.apiVersion.trim() || DEFAULT_AZURE_API_VERSION;
  } else if (provider === 'vertex') {
    if (isCreate && !form.serviceAccountJson.trim()) {
      return { body: {}, error: 'Service account JSON is required' };
    }
    if (form.serviceAccountJson.trim()) {
      // Light validation: parseable JSON.
      try {
        JSON.parse(form.serviceAccountJson);
      } catch {
        return { body: {}, error: 'Service account JSON is not valid JSON' };
      }
      secret.service_account_json = form.serviceAccountJson.trim();
    }
  } else if (provider === 'bedrock') {
    if (isCreate) {
      if (!form.accessKeyId.trim() || !form.secretAccessKey.trim()) {
        return {
          body: {},
          error: 'Access Key ID and Secret Access Key are required',
        };
      }
    }
    if (form.accessKeyId.trim()) secret.access_key_id = form.accessKeyId.trim();
    if (form.secretAccessKey.trim()) {
      secret.secret_access_key = form.secretAccessKey.trim();
    }
    if (form.sessionToken.trim()) secret.session_token = form.sessionToken.trim();
    if (form.defaultRegion.trim()) {
      extraConfig.default_region = form.defaultRegion.trim();
    }
  }

  if (isCreate) {
    const create: CredentialCreateBody = {
      name: form.name.trim() || 'default',
      isEnabled: form.isEnabled,
      secret,
      extraConfig,
    };
    return { body: create };
  }
  const update: CredentialUpdateBody = {
    name: form.name.trim() || 'default',
    isEnabled: form.isEnabled,
    // On PATCH the resolver merges with existing keys; blank values preserve.
    secret: Object.keys(secret).length > 0 ? secret : undefined,
    extraConfig,
  };
  return { body: update };
}

export function CredentialFormSlideOver({
  open,
  onClose,
  provider,
  credential,
}: CredentialFormSlideOverProps) {
  const titleId = useId();
  const create = useCreateCredential(provider);
  const update = useUpdateCredential(provider);
  const isCreate = credential === null;

  const [form, setForm] = useState<FormState>(() =>
    hydrateForm(provider, credential),
  );
  // Re-seed when the parent swaps credential out from under us (e.g. picks a
  // different row in the rail while the slide-over is open).
  useEffect(() => {
    setForm(hydrateForm(provider, credential));
  }, [provider, credential]);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setError(null);
    const built = buildBody(provider, form, isCreate);
    if (built.error) {
      setError(built.error);
      return;
    }
    setSaving(true);
    try {
      if (isCreate) {
        await create.mutateAsync(built.body as CredentialCreateBody);
        notificationService.success(
          `${LLM_PROVIDER_LABELS[provider]} credential created`,
        );
      } else {
        await update.mutateAsync({
          credentialId: credential!.id,
          body: built.body as CredentialUpdateBody,
        });
        notificationService.success(
          `${LLM_PROVIDER_LABELS[provider]} credential updated`,
        );
      }
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
      notificationService.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const fields = useMemo(
    () => renderProviderFields(provider, form, setForm, credential),
    [provider, form, credential],
  );

  return (
    <RightSlideOverShell
      isOpen={open}
      onClose={onClose}
      labelledBy={titleId}
      widthClassName="w-[var(--overlay-width-md)] max-w-[85vw]"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-6 py-4">
          <div className="flex items-center gap-3">
            <LLMProviderLogo provider={provider} size={28} />
            <div>
              <h2
                id={titleId}
                className="text-[15px] font-semibold text-[var(--text-primary)]"
              >
                {isCreate
                  ? `Add ${LLM_PROVIDER_LABELS[provider]} credential`
                  : `Edit ${LLM_PROVIDER_LABELS[provider]} credential`}
              </h2>
              <p className="text-[12px] text-[var(--text-muted)]">
                Stored encrypted; secrets never leave the backend.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Identity */}
          {provider !== 'vertex' && (
            <FormRow label="Credential name">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="default"
              />
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Unique per provider for this tenant. Use a descriptive label like
                "azure-east-prod" when running multiple resources.
              </p>
            </FormRow>
          )}

          <FormRow label="Enabled">
            <Switch
              checked={form.isEnabled}
              onCheckedChange={(on: boolean) =>
                setForm({ ...form, isEnabled: on })
              }
            />
          </FormRow>

          <hr className="border-[var(--border-subtle)]" />

          {fields}

          {error && (
            <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error-light)] px-3 py-2 text-[12px] text-[var(--color-error)]">
              {error}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-6 py-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isCreate ? 'Create credential' : 'Save changes'}
          </Button>
        </footer>
      </div>
    </RightSlideOverShell>
  );
}

function FormRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-[var(--text-primary)]">
        {label}
      </label>
      {children}
    </div>
  );
}

function renderProviderFields(
  provider: LlmProvider,
  form: FormState,
  setForm: (next: FormState) => void,
  credential: TenantCredential | null,
): React.ReactNode {
  const hasStoredSecret = !!credential?.secretPreview;
  const secretPlaceholder = hasStoredSecret
    ? `Stored: ${credential.secretPreview} — leave blank to keep`
    : '';

  if (provider === 'openai') {
    return (
      <>
        <FormRow label="API key">
          <Input
            type="password"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            placeholder={secretPlaceholder || 'sk-…'}
          />
        </FormRow>
        <FormRow label="Base URL (optional)">
          <Input
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
          />
        </FormRow>
      </>
    );
  }
  if (provider === 'anthropic' || provider === 'gemini') {
    return (
      <FormRow label="API key">
        <Input
          type="password"
          value={form.apiKey}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          placeholder={
            secretPlaceholder ||
            (provider === 'anthropic' ? 'sk-ant-…' : 'AIza…')
          }
        />
      </FormRow>
    );
  }
  if (provider === 'azure_openai') {
    return (
      <>
        <FormRow label="API key">
          <Input
            type="password"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            placeholder={secretPlaceholder || 'Azure resource key'}
          />
        </FormRow>
        <FormRow label="Azure endpoint">
          <Input
            value={form.endpoint}
            onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
            placeholder="https://<resource>.openai.azure.com"
          />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Per-resource. Multiple Azure resources = multiple credentials.
          </p>
        </FormRow>
        <FormRow label="API version">
          <Input
            value={form.apiVersion}
            onChange={(e) => setForm({ ...form, apiVersion: e.target.value })}
            placeholder={DEFAULT_AZURE_API_VERSION}
          />
        </FormRow>
        <p className="text-[11px] text-[var(--text-muted)]">
          After creating, add deployments under this credential to map Azure
          deployment names to canonical models.
        </p>
      </>
    );
  }
  if (provider === 'vertex') {
    return (
      <FormRow label="Service account JSON">
        <FileDropZone
          accept="application/json,.json"
          acceptLabel="Service account JSON file"
          onFilesSelected={(files) => {
            const file = files[0];
            if (!file) return;
            void file
              .text()
              .then((text) => setForm({ ...form, serviceAccountJson: text }));
          }}
        />
        <textarea
          value={form.serviceAccountJson}
          onChange={(e) =>
            setForm({ ...form, serviceAccountJson: e.target.value })
          }
          placeholder={
            hasStoredSecret
              ? `Stored: ${credential.secretPreview} — leave blank to keep`
              : '…or paste the full service-account JSON here'
          }
          rows={6}
          className="mt-2 w-full rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[12px] font-mono text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Upload or paste the service-account JSON. The project is read from the
          file; nothing else is needed.
        </p>
      </FormRow>
    );
  }
  if (provider === 'bedrock') {
    return (
      <>
        <FormRow label="Access Key ID">
          <Input
            type="password"
            value={form.accessKeyId}
            onChange={(e) => setForm({ ...form, accessKeyId: e.target.value })}
            placeholder={hasStoredSecret ? 'Stored — leave blank to keep' : 'AKIA…'}
          />
        </FormRow>
        <FormRow label="Secret Access Key">
          <Input
            type="password"
            value={form.secretAccessKey}
            onChange={(e) =>
              setForm({ ...form, secretAccessKey: e.target.value })
            }
            placeholder={hasStoredSecret ? 'Leave blank to keep' : ''}
          />
        </FormRow>
        <FormRow label="Session Token (optional)">
          <Input
            type="password"
            value={form.sessionToken}
            onChange={(e) =>
              setForm({ ...form, sessionToken: e.target.value })
            }
          />
        </FormRow>
        <FormRow label="Default region">
          <Input
            value={form.defaultRegion}
            onChange={(e) =>
              setForm({ ...form, defaultRegion: e.target.value })
            }
            placeholder={DEFAULT_BEDROCK_REGION}
          />
        </FormRow>
      </>
    );
  }
  return null;
}
