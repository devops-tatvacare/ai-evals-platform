/** Chat-widget message surface — scroll host around the turn-grouped renderer. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';

import { cn } from '@/utils/cn';
import { TurnList } from '@/features/sherlock/TurnList';
import { useStreamStore, selectSessionParts } from '@/features/sherlock/streamStore';
import { useSessionParts } from '@/features/sherlock/queries/parts';

import { EmptyState } from './components/EmptyState';
import { useChatWidgetStore } from './useChatWidget';
import type { PromptTemplate } from './types';

interface ChatMessagesProps {
  status: 'idle' | 'sending' | 'error';
  appId: string;
  onRetry: () => void;
  promptTemplates?: PromptTemplate[];
  onPromptSelect?: (prompt: string) => void;
}

export function ChatMessages({
  status,
  appId,
  onRetry,
  promptTemplates,
  onPromptSelect,
}: ChatMessagesProps) {
  const sessionId = useChatWidgetStore((s) => s.sessionId);
  const parts = useStreamStore(selectSessionParts(sessionId ?? ''));

  // Hydrate the store from the snapshot endpoint whenever the active session
  // changes; appId is threaded so the backend can scope by tenant + app.
  useSessionParts(sessionId, appId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  const setBottom = useCallback((v: boolean) => {
    atBottomRef.current = v;
    setAtBottom((prev) => (prev === v ? prev : v));
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!scroller || !sentinel) return;
    const io = new IntersectionObserver(
      (entries) => setBottom(entries[0]?.isIntersecting ?? false),
      { root: scroller, rootMargin: '0px 0px 24px 0px', threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [setBottom]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) scroller.scrollTop = scroller.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (status !== 'sending') return;
    const node = scrollRef.current;
    if (!node) return;
    atBottomRef.current = true;
    node.scrollTop = node.scrollHeight;
  }, [status]);

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    atBottomRef.current = true;
    if (status === 'sending') node.scrollTop = node.scrollHeight;
    else node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [status]);

  const hasEmptyState = parts.length === 0 && status !== 'sending';
  const showJumpPill = !atBottom && status === 'sending';

  return (
    <div className="relative flex min-h-0 flex-1">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div
          ref={contentRef}
          className={cn('flex flex-col gap-4', hasEmptyState ? 'h-full' : 'px-3 py-3')}
        >
          {hasEmptyState ? (
            <EmptyState
              appId={appId}
              templates={promptTemplates ?? []}
              onSelect={(prompt) => onPromptSelect?.(prompt)}
            />
          ) : (
            <TurnList
              parts={parts}
              appId={appId}
              sessionId={sessionId}
              streaming={status === 'sending'}
              onRetry={onRetry}
            />
          )}

          <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
        </div>
      </div>

      {showJumpPill ? (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Jump to latest message"
          className={cn(
            'absolute bottom-3 left-1/2 z-[var(--z-sticky)] flex -translate-x-1/2 items-center gap-1.5',
            'rounded-full px-3 py-1.5 font-mono text-[11px] tracking-[0.04em]',
            'border bg-[var(--bg-elevated)]/95 backdrop-blur-sm shadow-lg',
            'border-[color-mix(in_srgb,var(--interactive-primary)_45%,transparent)]',
            'text-[var(--text-brand)]',
            'hover:bg-[var(--surface-brand-hover)] transition-colors',
          )}
        >
          <ArrowDown className="h-3 w-3" strokeWidth={2.5} />
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
