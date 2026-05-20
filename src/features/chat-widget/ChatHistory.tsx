import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, MessageCircle, Search, Trash2, X } from 'lucide-react';

import { cn } from '@/utils/cn';
import { useAppStore } from '@/stores';
import { useDebounce } from '@/hooks/useDebounce';
import type { ChatSearchHit } from '@/services/api/chatApi';
import type { AppId, KairaChatSession } from '@/types';

import { useChatWidgetStore } from './useChatWidget';
import {
  flattenHits,
  flattenSessions,
  useChatSearchInfinite,
  useChatSessionsInfinite,
  useDeleteChatSession,
} from './queries/useChatSessions';

function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Bold every case-insensitive run of `term` inside `text`.
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) {
      out.push(text.slice(i));
      break;
    }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(
      <strong key={key++} className="font-semibold text-[var(--text-primary)]">
        {text.slice(idx, idx + needle.length)}
      </strong>,
    );
    i = idx + needle.length;
  }
  return <>{out}</>;
}

const ROW_BASE = cn(
  'group flex w-full cursor-pointer rounded-lg px-3 py-2.5 text-left transition-colors',
  'hover:bg-[var(--bg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]',
);

function onRowKey(e: React.KeyboardEvent, onSelect: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onSelect();
  }
}

function SessionRow({
  session,
  active,
  deleting,
  onSelect,
  onDelete,
}: {
  session: KairaChatSession;
  active: boolean;
  deleting: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  // A clickable row (div, not button) with a real sibling delete button — the
  // previous button-in-button nesting swallowed the trash click so delete never
  // fired a request.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => onRowKey(e, onSelect)}
      className={cn(ROW_BASE, 'items-start gap-2.5', active && 'bg-[var(--bg-secondary)]')}
    >
      <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-[var(--text-primary)]">{session.title}</div>
        <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
          {formatRelativeDate(session.updatedAt)}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        disabled={deleting}
        title="Delete conversation"
        aria-label="Delete conversation"
        className={cn(
          'shrink-0 rounded p-1 text-[var(--text-muted)] transition-all',
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          'hover:bg-[color-mix(in_srgb,var(--color-verdict-fail)_12%,transparent)] hover:text-[var(--color-verdict-fail)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function SearchHitRow({ hit, term, onSelect }: { hit: ChatSearchHit; term: string; onSelect: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => onRowKey(e, onSelect)}
      className={cn(ROW_BASE, 'flex-col gap-0.5')}
    >
      <div className="truncate text-sm text-[var(--text-muted)]">
        <Highlight text={hit.title} term={term} />
      </div>
      {hit.snippet ? (
        <div className="line-clamp-2 text-sm leading-snug text-[var(--text-primary)]">
          <Highlight text={hit.snippet} term={term} />
        </div>
      ) : null}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <div className="mt-0.5 h-4 w-4 shrink-0 animate-pulse rounded bg-[var(--bg-secondary)]" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3.5 w-3/4 animate-pulse rounded bg-[var(--bg-secondary)]" />
        <div className="h-2.5 w-1/4 animate-pulse rounded bg-[var(--bg-secondary)]" />
      </div>
    </div>
  );
}

export function ChatHistory() {
  const currentApp = useAppStore((s) => s.currentApp) as AppId;
  const activeSessionId = useChatWidgetStore((s) => s.sessionId);
  const selectSession = useChatWidgetStore((s) => s.selectSession);
  const clearActiveSession = useChatWidgetStore((s) => s.clearActiveSession);

  const [searchInput, setSearchInput] = useState('');
  const query = useDebounce(searchInput.trim(), 300);
  const searching = query.length > 0;

  const browse = useChatSessionsInfinite(currentApp, !searching);
  const search = useChatSearchInfinite(currentApp, query, searching);
  const deleteMutation = useDeleteChatSession(currentApp);

  const active = searching ? search : browse;
  const sessions = flattenSessions(browse.data?.pages);
  const hits = flattenHits(search.data?.pages);
  const isEmpty = searching ? hits.length === 0 : sessions.length === 0;

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && active.hasNextPage && !active.isFetchingNextPage) {
          void active.fetchNextPage();
        }
      },
      { rootMargin: '120px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id, { onSuccess: () => clearActiveSession(id) });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="px-3 pb-2 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search conversations…"
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] py-2 pl-8 pr-8 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {active.isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
        ) : active.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              {searching ? 'Could not run search' : 'Could not load conversations'}
            </p>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
            <MessageCircle className="mb-3 h-8 w-8 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">
              {searching ? `No conversations match “${query}”` : 'No conversations yet'}
            </p>
            {!searching ? (
              <p className="mt-1 text-xs text-[var(--text-muted)]">Start a new chat to begin</p>
            ) : null}
          </div>
        ) : (
          <>
            {searching
              ? hits.map((hit, i) => (
                  <SearchHitRow
                    key={`${hit.sessionId}-${i}`}
                    hit={hit}
                    term={query}
                    onSelect={() => void selectSession(currentApp, hit.sessionId)}
                  />
                ))
              : sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    active={session.id === activeSessionId}
                    deleting={deleteMutation.isPending && deleteMutation.variables === session.id}
                    onSelect={() => void selectSession(currentApp, session.id)}
                    onDelete={() => handleDelete(session.id)}
                  />
                ))}
            {active.isFetchingNextPage ? <SkeletonRow /> : null}
            <div ref={sentinelRef} className="h-px" />
          </>
        )}
      </div>
    </div>
  );
}
