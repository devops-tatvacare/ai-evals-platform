import { useState } from 'react';
import { Sparkles } from 'lucide-react';

import { PageSurface } from '@/components/ui';
import type { LLMProvider } from '@/services/api/aiSettingsApi';
import type { LlmProvider } from '@/services/api/llmCredentialsApi';
import { LLM_PROVIDER_LABELS } from '@/constants/llmProviders';

import { ProviderConfigPanel } from './ProviderConfigPanel';
import { ProviderRail } from './ProviderRail';

const BRIDGE_PROVIDERS = new Set<LLMProvider>([
  'openai',
  'azure_openai',
  'anthropic',
  'gemini',
]);

function isBridgeProvider(p: LlmProvider): p is LLMProvider {
  return BRIDGE_PROVIDERS.has(p as LLMProvider);
}

export function AdminAISettingsPage() {
  const [selected, setSelected] = useState<LlmProvider>('openai');

  return (
    <PageSurface
      icon={Sparkles}
      title="Model Providers"
      subtitle="Enable providers and configure API keys for AI access"
    >
      <div className="flex h-full min-h-0 gap-4">
        <aside className="w-64 shrink-0 overflow-y-auto">
          <ProviderRail selected={selected} onSelect={setSelected} />
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          {isBridgeProvider(selected) ? (
            <ProviderConfigPanel provider={selected} />
          ) : (
            <NotYetWiredPanel provider={selected} />
          )}
        </section>
      </div>
    </PageSurface>
  );
}

function NotYetWiredPanel({ provider }: { provider: LlmProvider }) {
  // Vertex + Bedrock are backed end-to-end in Phase 1 (backend) but their
  // per-provider credential forms are not built yet — the legacy
  // ProviderConfigPanel only knows the four api-key-shaped providers. Until
  // the per-provider forms ship, surface a placeholder so the rail can list
  // these providers without crashing the page.
  return (
    <div className="rounded-md border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)] p-6 text-sm text-[var(--text-secondary)]">
      <p className="mb-2 font-medium text-[var(--text-primary)]">
        {LLM_PROVIDER_LABELS[provider]} credentials
      </p>
      <p>
        Backend is ready; the multi-field credential form for this provider
        is pending. Tracking on this branch &mdash; pull when the per-provider
        form lands. Engineers can call the multi-credential API directly in
        the meantime.
      </p>
    </div>
  );
}
