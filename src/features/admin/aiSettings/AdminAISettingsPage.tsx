import { useState } from 'react';
import { Sparkles } from 'lucide-react';

import { PageSurface } from '@/components/ui';
import type { LlmProvider } from '@/services/api/llmCredentialsApi';

import { MultiCredentialPanel } from './MultiCredentialPanel';
import { ProviderRail } from './ProviderRail';

export function AdminAISettingsPage() {
  const [selected, setSelected] = useState<LlmProvider>('openai');

  return (
    <PageSurface
      icon={Sparkles}
      title="Model Providers"
      subtitle="Multi-credential per provider. Add as many keys as you run resources for; map each to capability defaults under LLM Defaults."
    >
      <div className="flex h-full min-h-0 gap-0 pt-4">
        <aside className="w-64 shrink-0 overflow-y-auto pr-5">
          <ProviderRail selected={selected} onSelect={setSelected} />
        </aside>
        <section className="flex min-w-0 flex-1 flex-col border-l border-[var(--border-subtle)] pl-5">
          <MultiCredentialPanel provider={selected} />
        </section>
      </div>
    </PageSurface>
  );
}
