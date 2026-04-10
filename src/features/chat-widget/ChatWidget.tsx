import { useEffect, useCallback, useRef, useState } from 'react';
import { Sparkles, X, Minus, Plus, GripVertical } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAppStore } from '@/stores';
import { useLLMSettingsStore, hasProviderCredentials } from '@/stores/llmSettingsStore';
import { useChatWidgetStore } from './useChatWidget';
import { ProviderToggle } from './ProviderToggle';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import type { ChatProvider, ChatWidgetConfig } from './types';

/** Clamp a value between min and max. */
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function ChatWidget() {
  const currentApp = useAppStore((s) => s.currentApp);
  const appConfig = useAppStore((s) => s.getAppConfig(currentApp));
  const chatConfig: ChatWidgetConfig = (appConfig as any)?.chat ?? {};

  const open = useChatWidgetStore((s) => s.open);
  const toggle = useChatWidgetStore((s) => s.toggle);
  const provider = useChatWidgetStore((s) => s.provider);
  const locked = useChatWidgetStore((s) => s.locked);
  const messages = useChatWidgetStore((s) => s.messages);
  const status = useChatWidgetStore((s) => s.status);
  const defaults = useChatWidgetStore((s) => s.defaults);
  const setProvider = useChatWidgetStore((s) => s.setProvider);
  const send = useChatWidgetStore((s) => s.send);
  const reset = useChatWidgetStore((s) => s.reset);
  const loadDefaults = useChatWidgetStore((s) => s.loadDefaults);

  // Position state (bottom-right corner anchor)
  const [pos, setPos] = useState({ bottom: 24, right: 24 });
  // Size state for expanded panel
  const [size, setSize] = useState({ width: 420, height: 560 });

  // ── Full-canvas drag (header) ──
  const dragRef = useRef<{ startX: number; startY: number; startRight: number; startBottom: number } | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startRight: pos.right, startBottom: pos.bottom };

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = dragRef.current.startX - ev.clientX;
      const dy = dragRef.current.startY - ev.clientY;
      setPos({
        right: clamp(dragRef.current.startRight + dx, 8, window.innerWidth - 80),
        bottom: clamp(dragRef.current.startBottom + dy, 8, window.innerHeight - 80),
      });
    };

    const handleUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [pos]);

  // ── Resize by dragging top edge ──
  const resizeRef = useRef<{ startY: number; startHeight: number; startBottom: number } | null>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startY: e.clientY, startHeight: size.height, startBottom: pos.bottom };

    const handleMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dy = resizeRef.current.startY - ev.clientY;
      const newHeight = clamp(resizeRef.current.startHeight + dy, 300, window.innerHeight - 40);
      setSize((s) => ({ ...s, height: newHeight }));
    };

    const handleUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [size.height, pos.bottom]);

  useEffect(() => {
    if (!defaults) void loadDefaults();
  }, [defaults, loadDefaults]);

  const geminiApiKey = useLLMSettingsStore((s) => s.geminiApiKey);
  const openaiApiKey = useLLMSettingsStore((s) => s.openaiApiKey);
  const azureApiKey = useLLMSettingsStore((s) => s.azureOpenaiApiKey);
  const azureEndpoint = useLLMSettingsStore((s) => s.azureOpenaiEndpoint);
  const saConfigured = useLLMSettingsStore((s) => s._serviceAccountConfigured);

  const credState = { geminiApiKey, openaiApiKey, azureOpenaiApiKey: azureApiKey, azureOpenaiEndpoint: azureEndpoint, anthropicApiKey: '', _serviceAccountConfigured: saConfigured };
  const providerDisabled: Record<ChatProvider, boolean> = {
    gemini: !hasProviderCredentials('gemini', credState),
    openai: !hasProviderCredentials('openai', credState) && !hasProviderCredentials('azure_openai', credState),
  };

  const handleSend = useCallback(
    (text: string) => void send(text, currentApp),
    [send, currentApp],
  );

  const promptTemplates = chatConfig.promptTemplates ?? [];

  if (chatConfig.enabled === false) return null;

  // Collapsed bubble
  if (!open) {
    return (
      <button
        onClick={toggle}
        style={{ bottom: pos.bottom, right: pos.right }}
        className={cn(
          'fixed z-[var(--z-overlay)]',
          'flex h-14 w-14 items-center justify-center rounded-full',
          'bg-[var(--color-brand-primary)] text-white shadow-lg',
          'hover:bg-[var(--color-brand-primary-hover)] hover:scale-105',
          'transition-all duration-150',
        )}
        aria-label="Open AI Assistant"
      >
        <Sparkles className="h-6 w-6" />
      </button>
    );
  }

  // Expanded widget
  const canSend = !!provider && !providerDisabled[provider] && status !== 'sending' && !!defaults;

  return (
    <div
      style={{ bottom: pos.bottom, right: pos.right, width: size.width, height: size.height }}
      className={cn(
        'fixed z-[var(--z-overlay)]',
        'flex flex-col overflow-hidden rounded-2xl bg-[var(--bg-primary)] shadow-2xl',
        'border border-[var(--border-default)]',
      )}
    >
      {/* Top resize handle — drag to increase height upward */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute top-0 left-4 right-4 h-1.5 cursor-n-resize z-10 group"
      >
        <div className="mx-auto mt-0.5 h-0.5 w-10 rounded-full bg-[var(--border-default)] group-hover:bg-[var(--text-muted)] transition-colors" />
      </div>

      {/* Header with drag handle */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-default)] cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <div className="flex h-7 w-7 items-center justify-center rounded bg-[var(--color-brand-accent)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--color-brand-primary)]" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI Assistant</h3>
          <span className="text-[10px] font-medium text-[var(--color-brand-primary)] bg-[var(--color-brand-accent)] px-1.5 py-0.5 rounded">
            {currentApp}
          </span>
        </div>
        <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
          <button
            onClick={reset}
            title="New chat"
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={toggle}
            title="Minimize"
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => { toggle(); reset(); }}
            title="Close"
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ProviderToggle
        selected={provider}
        onSelect={setProvider}
        locked={locked}
        disabled={providerDisabled}
      />

      <ChatMessages
        messages={messages}
        status={status}
        promptTemplates={promptTemplates}
        onPromptSelect={handleSend}
      />

      <ChatInput
        onSend={handleSend}
        disabled={!canSend}
        placeholder={
          !provider
            ? 'Select a provider to start...'
            : !defaults
              ? 'Loading...'
              : `Ask about ${currentApp}...`
        }
      />
    </div>
  );
}
