import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Loader2, AlertCircle, ChevronDown, Check } from 'lucide-react';
import { discoverGeminiModels, discoverOpenAIModels, discoverModelsViaBackend, type GeminiModel } from '@/services/llm';
import { detectProvider, providerIcons } from '@/components/ui/ModelBadge/providers';
import { useLLMSettingsStore } from '@/stores';
import { cn } from '@/utils';
import type { LLMProvider } from '@/types';

interface ModelSelectorProps {
  apiKey: string;
  selectedModel: string;
  onChange: (model: string) => void;
  provider?: LLMProvider;
  /** 'api-key-only' = always use browser-side discovery; 'auto' = use backend when SA configured */
  mode?: 'api-key-only' | 'auto';
  /** Called when model discovery loading state changes */
  onLoadingChange?: (loading: boolean) => void;
}

export function ModelSelector({ apiKey, selectedModel, onChange, provider = 'gemini', mode = 'auto', onLoadingChange }: ModelSelectorProps) {
  const [models, setModels] = useState<GeminiModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const saConfigured = useLLMSettingsStore((s) => s._serviceAccountConfigured);
  const isServiceAccount = mode === 'api-key-only' ? false : (provider === 'gemini' && saConfigured);

  const loadModels = useCallback(async () => {
    if (!isServiceAccount && !apiKey) {
      setModels([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let discovered: GeminiModel[];
      if (isServiceAccount) {
        discovered = await discoverModelsViaBackend('gemini');
      } else if (provider === 'openai') {
        discovered = await discoverOpenAIModels(apiKey);
      } else {
        discovered = await discoverGeminiModels(apiKey);
      }
      setModels(discovered);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models');
      setModels([]);
    } finally {
      setIsLoading(false);
    }
  }, [apiKey, provider, isServiceAccount]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    onLoadingChange?.(isLoading);
  }, [isLoading, onLoadingChange]);

  const filteredModels = useMemo(() => {
    if (!searchQuery) return models;
    const query = searchQuery.toLowerCase();
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(query) ||
        m.displayName.toLowerCase().includes(query)
    );
  }, [models, searchQuery]);

  const selectedModelInfo = useMemo(
    () => models.find((m) => m.name === selectedModel),
    [models, selectedModel]
  );

  const handleSelect = (model: GeminiModel) => {
    onChange(model.name);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="relative">
      <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
        Model
      </label>
      <p className="text-[12px] text-[var(--text-muted)] mb-2">
        Select the AI model for evaluations
      </p>

      {/* Selected model display / trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading || (!apiKey && !isServiceAccount)}
        className={cn(
          'w-full flex items-center justify-between rounded-[6px] border px-3 py-2 text-left text-[14px]',
          'bg-[var(--input-bg)] border-[var(--border-default)]',
          'hover:border-[var(--border-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--border-brand)]/30',
          'disabled:opacity-50 disabled:cursor-not-allowed'
        )}
      >
        <span className="flex items-center gap-2 truncate">
          <img
            src={providerIcons[provider]}
            alt="Provider"
            className="h-4 w-4"
          />
          {!apiKey && !isServiceAccount ? (
            <span className="text-[var(--text-muted)]">Enter API key first</span>
          ) : isLoading ? (
            <span className="text-[var(--text-muted)]">Loading models...</span>
          ) : selectedModelInfo ? (
            <span className="text-[var(--text-primary)]">{selectedModelInfo.displayName}</span>
          ) : selectedModel ? (
            <span className="text-[var(--text-primary)]">{selectedModel}</span>
          ) : (
            <span className="text-[var(--text-muted)]">Select a model</span>
          )}
        </span>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
        ) : (
          <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
        )}
      </button>

      {/* Error message */}
      {error && !isLoading && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--color-warning)]">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Dropdown */}
      {isOpen && models.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg">
          {/* Search */}
          <div className="p-2 border-b border-[var(--border-subtle)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models..."
                className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded border border-[var(--border-subtle)] bg-[var(--input-bg)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--border-brand)]/30"
                autoFocus
              />
            </div>
          </div>

          {/* Model list */}
          <div className="max-h-64 overflow-y-auto p-1">
            {filteredModels.length === 0 ? (
              <div className="px-3 py-4 text-center text-[13px] text-[var(--text-muted)]">
                No models found
              </div>
            ) : (
              filteredModels.map((model) => (
                <button
                  key={model.name}
                  onClick={() => handleSelect(model)}
                  className={cn(
                    'w-full flex items-start gap-3 rounded px-3 py-2 text-left transition-colors',
                    model.name === selectedModel
                      ? 'bg-[var(--color-brand-accent)]/10 text-[var(--text-brand)]'
                      : 'hover:bg-[var(--interactive-secondary)] text-[var(--text-primary)]'
                  )}
                >
                  <img
                    src={providerIcons[detectProvider(model.name)]}
                    alt="Provider"
                    className="h-4 w-4 mt-0.5 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium truncate">
                        {model.displayName}
                      </span>
                      {model.name === selectedModel && (
                        <Check className="h-4 w-4 text-[var(--text-brand)]" />
                      )}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">
                      {model.name}
                    </div>
                    {(model.inputTokenLimit || model.outputTokenLimit) && (
                      <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                        {model.inputTokenLimit && `Input: ${(model.inputTokenLimit / 1000).toFixed(0)}k`}
                        {model.inputTokenLimit && model.outputTokenLimit && ' • '}
                        {model.outputTokenLimit && `Output: ${(model.outputTokenLimit / 1000).toFixed(0)}k`}
                      </div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Click outside to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setIsOpen(false);
            setSearchQuery('');
          }}
        />
      )}
    </div>
  );
}
