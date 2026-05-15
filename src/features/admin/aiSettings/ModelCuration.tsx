import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button, Combobox, EmptyState, Input } from '@/components/ui';
import { ApiError } from '@/services/api/client';
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
 * Curated model picker.
 *
 * - **OpenAI / Anthropic / Gemini** — Combobox in async multi-select mode.
 *   Typing fires `/api/admin/ai-settings/providers/<p>/discover-models`;
 *   results render as a real dropdown that closes on outside click. A
 *   "Selected Models" list below shows what's curated with per-row remove.
 * - **Azure OpenAI** — no public deployment listing exists; the admin types
 *   each deployment name and hits Add.
 *
 * Disabled state: when no key is stored AND none is being typed, we don't
 * mount the Combobox at all — Combobox auto-fires `onSearchChange('')` on
 * mount, which would hit the backend, 409 with "provider not configured",
 * and (until we stabilised refs) drive the mutation into an infinite loop.
 * Rendering a hint instead is correct UX *and* sidesteps the loop entirely.
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
  // Destructure `mutateAsync` + `isPending` so we depend on the stable
  // function ref instead of the result object (which is a new ref every
  // render). TanStack guarantees `mutateAsync` is stable across renders;
  // the previous version depended on the result object directly, which
  // recreated the search handler every time `isPending` flipped and
  // caused Combobox's onSearchChange useEffect to fire in a loop.
  const { mutateAsync: discoverModels, isPending: isDiscovering } =
    useDiscoverModels();
  const [results, setResults] = useState<string[]>([]);
  const debounceRef = useRef<number | null>(null);

  const runDiscovery = useCallback(
    async (query: string) => {
      try {
        const data = await discoverModels({
          provider,
          search: query,
        });
        setResults(data.models);
      } catch (err) {
        // 409 here just means the tenant hasn't saved a key yet for this
        // provider — that's the expected state on first visit, not an
        // error. Empty the result list and stay silent.
        if (err instanceof ApiError && err.status === 409) {
          setResults([]);
          return;
        }
        const message =
          err instanceof Error ? err.message : 'Model discovery failed';
        notificationService.error(message);
      }
    },
    [provider, discoverModels],
  );

  // Stable handler — only changes when provider switches. Combobox's
  // onSearchChange useEffect uses this as a dep; if it churned every
  // render the effect would re-fire and we'd loop.
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

  // Provider switches remount the parent PanelInner (it carries
  // `key={provider}`), so this component's state resets implicitly — no
  // useEffect-driven reset needed. Just clean up the debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Combobox needs every already-curated value as a known option so the
  // checkbox state and pill rendering line up.
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

  const handleRemove = (name: string) => {
    onChange(curatedModels.filter((m) => m !== name));
  };

  if (disabled) {
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
        <p className="rounded-md border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
          Save an API key first — then search the provider&rsquo;s catalogue
          and curate the models you want users to see.
        </p>
      </section>
    );
  }

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
        loading={isDiscovering}
        placeholder="Search models (e.g. gpt, claude, gemini)…"
      />

      <p className="text-[11px] text-[var(--text-secondary)]">
        Models you select here are the only ones surfaced to users in
        evaluator wizards and run overlays.
      </p>

      <div className="flex flex-col gap-1">
        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Selected Models
        </h4>
        {curatedModels.length === 0 ? (
          <EmptyState
            icon={Plus}
            title="No models curated yet"
            description="Use the search above to add models for this provider."
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
      </div>
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

      <div className="flex flex-col gap-1">
        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Selected Deployments
        </h4>
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
      </div>
    </section>
  );
}
