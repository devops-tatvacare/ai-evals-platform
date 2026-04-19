import { useEffect, useCallback, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, GripVertical, MessageCirclePlus, History, AlertCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/utils/cn';
import { useViewportSize } from '@/hooks';
import { settingsRouteForApp } from '@/config/routes';

function SherlockIcon({ className }: { className?: string }) {
  return (
    <img
      src="/sherlock-icon.svg"
      alt="Sherlock"
      className={cn(className, 'brightness-0 invert')}
    />
  );
}
import { useAppStore, useUIStore } from '@/stores';
import { useReviewModeStore } from '@/stores/reviewModeStore';
import { useLLMSettingsStore, hasProviderCredentials } from '@/stores/llmSettingsStore';
import { useChatWidgetStore } from './useChatWidget';
import { findLastChartParts, isChartPart } from './chatWidgetHelpers';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { ChatHistory } from './ChatHistory';
import { DashboardBar } from './components/DashboardBar';
import type { ChatProvider, SaveToastPart } from './types';
import type { AppChatConfig } from '@/types/app.types';

/** Clamp a value between min and max. */
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const WIDGET_LAYOUT_KEY = 'sherlock-widget-layout';
// DEFAULT_POS is the widget's starting drag position AND the FAB's permanent anchor.
// The expanded widget owns a mutable pos (via drag); the collapsed FAB always renders here.
const DEFAULT_POS = { bottom: 24, right: 24 };
const DEFAULT_SIZE = { width: 504, height: 672 };
type Cubic = [number, number, number, number];
const SHARED_EASE: Cubic = [0.22, 1, 0.36, 1];
const SCALE_TRANSITION = { duration: 0.18, ease: SHARED_EASE };

interface WidgetLayout {
  pos: { bottom: number; right: number };
  size: { width: number; height: number };
}

function loadLayout(): WidgetLayout {
  try {
    const raw = localStorage.getItem(WIDGET_LAYOUT_KEY);
    if (!raw) return { pos: DEFAULT_POS, size: DEFAULT_SIZE };
    const parsed = JSON.parse(raw) as Partial<WidgetLayout>;
    return {
      pos: {
        bottom: typeof parsed.pos?.bottom === 'number' ? parsed.pos.bottom : DEFAULT_POS.bottom,
        right: typeof parsed.pos?.right === 'number' ? parsed.pos.right : DEFAULT_POS.right,
      },
      size: {
        width: typeof parsed.size?.width === 'number' ? parsed.size.width : DEFAULT_SIZE.width,
        height: typeof parsed.size?.height === 'number' ? parsed.size.height : DEFAULT_SIZE.height,
      },
    };
  } catch {
    return { pos: DEFAULT_POS, size: DEFAULT_SIZE };
  }
}

function saveLayout(layout: WidgetLayout): void {
  try {
    localStorage.setItem(WIDGET_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // storage may be unavailable; silently ignore
  }
}

export function ChatWidget() {
  const titleId = useId();
  const viewport = useViewportSize();
  const reviewActive = useReviewModeStore((s) => s.active);
  const activeModal = useUIStore((s) => s.activeModal);
  const rightOverlayOpen = useUIStore((s) => s.rightOverlayCount > 0);
  const currentApp = useAppStore((s) => s.currentApp);
  const appConfig = useAppStore((s) => s.getAppConfig(currentApp));
  const chatConfig: AppChatConfig = appConfig?.chat ?? {};

  const open = useChatWidgetStore((s) => s.open);
  const toggle = useChatWidgetStore((s) => s.toggle);
  const messages = useChatWidgetStore((s) => s.messages);
  const status = useChatWidgetStore((s) => s.status);
  const defaults = useChatWidgetStore((s) => s.defaults);
  const view = useChatWidgetStore((s) => s.view);
  const setView = useChatWidgetStore((s) => s.setView);
  const send = useChatWidgetStore((s) => s.send);
  const openWithPrompt = useChatWidgetStore((s) => s.openWithPrompt);
  const pendingPrompt = useChatWidgetStore((s) => s.pendingPrompt);
  const consumePendingPrompt = useChatWidgetStore((s) => s.consumePendingPrompt);
  const retryLastMessage = useChatWidgetStore((s) => s.retryLastMessage);
  const newChat = useChatWidgetStore((s) => s.newChat);
  const loadDefaults = useChatWidgetStore((s) => s.loadDefaults);
  const restoreSession = useChatWidgetStore((s) => s.restoreSession);
  const appendMessagePart = useChatWidgetStore((s) => s.appendMessagePart);
  const sessionId = useChatWidgetStore((s) => s.sessionId);

  const dashboardCharts = useMemo(() => findLastChartParts(messages), [messages]);
  const defaultDashboardTitle = useMemo(() => {
    const first = dashboardCharts[0];
    return first ? `${first.spec.title} dashboard` : 'Untitled dashboard';
  }, [dashboardCharts]);

  const handleDashboardSaved = useCallback((toast: SaveToastPart) => {
    const target = [...messages].reverse().find(
      (m) => m.role === 'assistant' && m.parts.some(isChartPart),
    );
    if (target) {
      appendMessagePart(target.id, toast);
    }
  }, [messages, appendMessagePart]);

  // Position state for the EXPANDED widget only — persisted. The collapsed FAB is anchored
  // at DEFAULT_POS (screen bottom-right) and does not read this state.
  const [widgetPos, setWidgetPos] = useState(() => loadLayout().pos);
  // Size state for expanded panel — persisted
  const [size, setSize] = useState(() => loadLayout().size);

  // ── Full-canvas drag (header) ──
  const dragRef = useRef<{ startX: number; startY: number; startRight: number; startBottom: number } | null>(null);

  const sizeRef = useRef(size);
  const widgetPosRef = useRef(widgetPos);
  useEffect(() => {
    sizeRef.current = size;
    widgetPosRef.current = widgetPos;
    saveLayout({ pos: widgetPos, size });
  }, [widgetPos, size]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const currentPos = widgetPosRef.current;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startRight: currentPos.right, startBottom: currentPos.bottom };

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = dragRef.current.startX - ev.clientX;
      const dy = dragRef.current.startY - ev.clientY;
      const s = sizeRef.current;
      // Drag handlers read the live viewport from window directly — this runs
      // between renders, so subscribing via useViewportSize would be stale.
      setWidgetPos({
        right: clamp(dragRef.current.startRight + dx, 8, window.innerWidth - s.width - 8),
        bottom: clamp(dragRef.current.startBottom + dy, 8, window.innerHeight - s.height - 8),
      });
    };

    const handleUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, []);

  // ── Resize by dragging edges ──
  const resizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number; edge: string } | null>(null);

  const handleResizeStart = useCallback((edge: 'top' | 'left' | 'top-left') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startWidth: size.width, startHeight: size.height, edge };

    const handleMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const { edge: ed, startX, startY, startWidth, startHeight } = resizeRef.current;

      // Live viewport read — same reasoning as handleDragStart.
      if (ed === 'top' || ed === 'top-left') {
        const dy = startY - ev.clientY;
        setSize((s) => ({ ...s, height: clamp(startHeight + dy, 300, window.innerHeight - 40) }));
      }
      if (ed === 'left' || ed === 'top-left') {
        const dx = startX - ev.clientX;
        setSize((s) => ({ ...s, width: clamp(startWidth + dx, 360, window.innerWidth - 40) }));
      }
    };

    const handleUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [size.width, size.height]);

  useEffect(() => {
    if (!defaults) void loadDefaults();
  }, [defaults, loadDefaults]);

  // Restore active session from sessionStorage on mount
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !defaults) return;
    restoredRef.current = true;
    void restoreSession(currentApp);
  }, [defaults, currentApp, restoreSession]);

  useEffect(() => {
    if (!defaults || !pendingPrompt) return;
    const prompt = consumePendingPrompt();
    if (!prompt) return;
    void send(prompt, currentApp);
  }, [consumePendingPrompt, currentApp, defaults, pendingPrompt, send]);

  // Reset chat when app changes — session is app-scoped
  const prevAppRef = useRef(currentApp);
  useEffect(() => {
    if (prevAppRef.current !== currentApp) {
      prevAppRef.current = currentApp;
      newChat();
    }
  }, [currentApp, newChat]);

  const openaiApiKey = useLLMSettingsStore((s) => s.openaiApiKey);
  const azureApiKey = useLLMSettingsStore((s) => s.azureOpenaiApiKey);
  const azureEndpoint = useLLMSettingsStore((s) => s.azureOpenaiEndpoint);

  const credState = {
    geminiApiKey: '',
    openaiApiKey,
    azureOpenaiApiKey: azureApiKey,
    azureOpenaiEndpoint: azureEndpoint,
    anthropicApiKey: '',
    _serviceAccountConfigured: false,
  };
  const providerDisabled: Record<ChatProvider, boolean> = {
    openai: !hasProviderCredentials('openai', credState) && !hasProviderCredentials('azure_openai', credState),
  };

  const handleSend = useCallback(
    (text: string) => void send(text, currentApp),
    [send, currentApp],
  );

  const handleRetry = useCallback(
    () => void retryLastMessage(currentApp),
    [currentApp, retryLastMessage],
  );



  if (reviewActive) return null;
  if (activeModal || rightOverlayOpen) return null;
  if (chatConfig.enabled === false) return null;

  const isStreaming = status === 'sending';
  const canSend = !providerDisabled.openai && status !== 'sending' && !!defaults;
  const needsCredentials = providerDisabled.openai;
  const settingsPath = settingsRouteForApp(currentApp);

  return (
    <AnimatePresence initial={false}>
      {!open ? (
        <motion.button
          key="sherlock-fab"
          onClick={toggle}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={SCALE_TRANSITION}
          whileHover={{ scale: 1.08 }}
          style={{
            bottom: DEFAULT_POS.bottom,
            right: DEFAULT_POS.right,
            transformOrigin: 'bottom right',
            background:
              'linear-gradient(135deg, var(--color-brand-primary) 0%, var(--color-brand-primary-hover) 50%, var(--color-brand-primary-deep) 100%)',
          }}
          className={cn(
            'fixed z-[var(--z-overlay)]',
            'flex h-14 w-14 items-center justify-center rounded-full',
            'text-white shadow-lg hover:shadow-xl',
          )}
          aria-label={isStreaming ? 'Open Sherlock — responding…' : 'Open Sherlock'}
        >
          <SherlockIcon className="h-8 w-8" />
          {isStreaming && (
            <span
              className="absolute top-0.5 right-0.5 flex h-3 w-3"
              aria-hidden="true"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-info)] opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--color-info)] border-2 border-white" />
            </span>
          )}
        </motion.button>
      ) : (
        <motion.div
          key="sherlock-widget"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={SCALE_TRANSITION}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && view === 'history') {
              e.stopPropagation();
              setView('chat');
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              toggle();
            }
          }}
          style={{
            bottom: clamp(widgetPos.bottom, 8, viewport.height - size.height - 8),
            right: clamp(widgetPos.right, 8, viewport.width - size.width - 8),
            width: Math.min(size.width, viewport.width - 16),
            height: Math.min(size.height, viewport.height - 16),
            transformOrigin: 'bottom right',
          }}
          className={cn(
            'fixed z-[var(--z-overlay)]',
            'flex flex-col overflow-hidden rounded-2xl bg-[var(--bg-primary)] shadow-2xl',
            'border border-[var(--border-default)]',
            'focus:outline-none',
          )}
          tabIndex={-1}
        >
      {/* Resize handles */}
      <div onMouseDown={handleResizeStart('top')} className="absolute top-0 left-4 right-4 h-1.5 cursor-n-resize z-10 group">
        <div className="mx-auto mt-0.5 h-0.5 w-10 rounded-full bg-[var(--border-default)] group-hover:bg-[var(--text-muted)] transition-colors" />
      </div>
      <div onMouseDown={handleResizeStart('left')} className="absolute top-4 bottom-4 left-0 w-1.5 cursor-w-resize z-10" />
      <div onMouseDown={handleResizeStart('top-left')} className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize z-20" />

      {/* Header with drag handle */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-default)] cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: 'linear-gradient(135deg, var(--color-brand-primary) 0%, var(--color-brand-primary-hover) 50%, var(--color-brand-primary-deep) 100%)' }}
          >
            <SherlockIcon className="h-5 w-5" />
          </div>
          <h3 id={titleId} className="text-sm font-semibold text-[var(--text-primary)]">Sherlock</h3>
          <span className="text-[10px] font-medium text-[var(--color-brand-primary)] bg-[var(--color-brand-accent)] px-1.5 py-0.5 rounded">
            {currentApp}
          </span>
        </div>
        <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
          <button
            onClick={newChat}
            title="New chat"
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <MessageCirclePlus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setView(view === 'history' ? 'chat' : 'history')}
            title={view === 'history' ? 'Back to chat' : 'Chat history'}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded transition-colors',
              view === 'history'
                ? 'text-[var(--color-brand-primary)] bg-[var(--color-brand-accent)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]',
            )}
          >
            <History className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={toggle}
            title="Minimize"
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {view === 'history' ? (
        <ChatHistory />
      ) : (
        <>
          <ChatMessages
            messages={messages}
            status={status}
            appId={currentApp}
            onRetry={handleRetry}
            promptTemplates={chatConfig.promptTemplates}
            onPromptSelect={(prompt) => openWithPrompt(prompt, currentApp)}
          />

          {dashboardCharts.length >= 2 && status !== 'sending' ? (
            <div className="px-3 py-2">
              <DashboardBar
                appId={currentApp}
                sessionId={sessionId}
                charts={dashboardCharts}
                defaultTitle={defaultDashboardTitle}
                onSaved={handleDashboardSaved}
              />
            </div>
          ) : null}

          {needsCredentials ? (
            <div className="mx-3 mb-2 rounded-md border border-[var(--border-warning)] bg-[var(--surface-warning)] px-3 py-2 flex items-start gap-2 text-[12px] text-[var(--text-primary)]">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-[var(--color-warning)]" />
              <div className="flex-1">
                <p className="font-medium">LLM credentials required</p>
                <p className="text-[var(--text-secondary)] mt-0.5">
                  Add an OpenAI or Azure OpenAI API key in{' '}
                  <Link to={settingsPath} className="font-medium text-[var(--text-brand)] underline underline-offset-2">
                    Settings
                  </Link>{' '}
                  to start chatting.
                </p>
              </div>
            </div>
          ) : null}

          <ChatInput
            onSend={handleSend}
            disabled={!canSend}
            placeholder={
              !defaults
                ? 'Loading...'
                : needsCredentials
                  ? 'Configure an LLM to start chatting'
                  : `Ask about ${currentApp}...`
            }
          />
        </>
      )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
