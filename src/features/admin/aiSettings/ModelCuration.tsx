import { useCallback, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button, Combobox, EmptyState, Input } from '@/components/ui';
import type { LLMProvider } from '@/services/api/aiSettingsApi';
import { useDiscoverModels } from '@/services/api/aiSettingsQueries';
import { notificationService } from '@/services/notifications/notificationService';

interface ModelCurationProps {
  provider: LLMProvider;
  curatedModels: string[];
  onChange: (models: string[]) => void;
  /** Discovery is disabled until the provider row has a saved key. */
  disabled?: boolean;
}

/**
 * Curated model picker. Two flavours:
 *
 * - **OpenAI / Anthropic / Gemini** — Combobox in async multi-select mode.
 *   Typing fires `/api/admin/ai-settings/providers/<p>/discover-models`
 *   server-side; results render as a real dropdown that closes on outside
 *   click. Reuses the same primitive `LLMConfigSection` uses for model
 *   selection elsewhere in the app.
 * - **Azure OpenAI** — no public deployment listing exists, so the admin
 *   types each deployment name (e.g. `ai-evals-gpt-5.4-mini`) into a plain
 *   input and hits Add. The selected list renders below with remove
 *   actions.
 */
export function ModelCuration({
  provider,
  curatedModels,
  onChange,
  disabled,
}: ModelCurationProps) {
  if (provider === 'azure_openai') {
    return (
      <AzureDeploymentCuration
        curatedModels={curatedModels}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }
  return (
    <ProviderModelCombobox
      provider={provider}
      curatedModels={curatedModels}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

function ProviderModelCombobox({
  provider,
  curatedModels,
  onChange,
  disabled,
}: ModelCurationProps) {
  const discover = useDiscoverModels();
  const [results, setResults] = useState<string[]>([]);
  const debounceRef = useRef<number | null>(null);

  const runDiscovery = useCallback(
    async (query: string) => {
      try {
        const data = await discover.mutateAsync({ provider, search: query });
        setResults(data.models);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Model discovery failed';
        notificationService.error(message);
      }
    },
    [discover, provider],
  );

  // Combobox fires `onSearchChange('')` on mount (async mode), so we don't
  // need a separate initial-fetch effect — debounce-relay every keystroke.
  const handleSearchChange = useCallback(
    (query: string) => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        void runDiscovery(query.trim());
      }, 200);
    },
    [runDiscovery],
  );

  // Merge the API result with any already-curated names so removing a
  // curated entry from inside the dropdown still finds it as a known option.
  const options = useMemo(() => {
    const seen = new Set<string>();
    const all: string[] = [];
    for (const name of [...curatedModels, ...results]) {
      if (!seen.has(name)) {
        seen.add(name);
        all.push(name);
      }
    }
    return all.map((value) => ({ value, label: value }));
  }, [curatedModels, results]);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
          Models
        </h3>
        <span className="text-[11px] text-[var(--text-secondary)]">
          {curatedModels.length} selected
        </span>
      </header>

      <Combobox
        multi
        value={curatedModels}
        onChange={onChange}
        options={options}
        onSearchChange={handleSearchChange}
        loading={discover.isPending}
        placeholder="Search models (e.g. gpt, claude, gemini)…"
        disabled={disabled}
      />

      <p className="text-[11px] text-[var(--text-secondary)]">
        Models you select here are the only ones surfaced to users in
        evaluator wizards and run overlays.
      </p>
    </section>
  );
}

function AzureDeploymentCuration({
  curatedModels,
  onChange,
  disabled,
}: Omit<ModelCurationProps, 'provider'>) {
  const [draft, setDraft] = useState('');

  const handleAdd = () => {
    const name = draft.trim();
    if (!name) return;
    if (curatedModels.includes(name)) {
      notificationService.info(`Deployment "${name}" is already added.`);
      return;
    }
    onChange([...curatedModels, name]);
    setDraft('');
  };

  const handleRemove = (name: string) => {
    onChange(curatedModels.filter((m) => m !== name));
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
          Deployments
        </h3>
        <span className="text-[11px] text-[var(--text-secondary)]">
          {curatedModels.length} selected
        </span>
      </header>

      <p className="text-[11px] text-[var(--text-secondary)]">
        Azure has no public model list — type each deployment name you
        created in the Azure portal (the same string passed as
        <code className="mx-1 rounded bg-[var(--bg-secondary)] px-1 font-mono text-[10px]">
          model
        </code>
        to the OpenAI SDK).
      </p>

      <div className="flex items-stretch gap-2">
        <div className="flex-1">
          <Input
            placeholder="ai-evals-gpt-5.4-mini"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
            disabled={disabled}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          icon={Plus}
          onClick={handleAdd}
          disabled={disabled || !draft.trim()}
        >
          Add
        </Button>
      </div>

      {curatedModels.length === 0 ? (
        <EmptyState
          icon={Plus}
          title="No deployments added yet"
          description="Type a deployment name above and press Enter."
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {curatedModels.map((name) => (
            <li
              key={name}
              className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-1.5"
            >
              <span className="truncate text-[13px] text-[var(--text-primary)]">
                {name}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={Trash2}
                iconOnly
                aria-label={`Remove ${name}`}
                onClick={() => handleRemove(name)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
