import { useEffect } from 'react';
import { MessageCircle, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAppStore } from '@/stores';
import { useChatWidgetStore } from './useChatWidget';
import type { WidgetSessionSummary } from './types';

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

function SessionItem({
  session,
  onSelect,
  onDelete,
}: {
  session: WidgetSessionSummary;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left group',
        'hover:bg-[var(--bg-secondary)] transition-colors',
      )}
    >
      <MessageCircle className="h-4 w-4 mt-0.5 shrink-0 text-[var(--text-muted)]" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[var(--text-primary)] truncate">{session.title}</div>
        <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
          {formatRelativeDate(session.updatedAt)}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded text-[var(--text-muted)] hover:text-[var(--color-verdict-fail)] hover:bg-[var(--color-verdict-fail)]/10 transition-all"
        title="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </button>
  );
}

export function ChatHistory() {
  const currentApp = useAppStore((s) => s.currentApp);
  const sessions = useChatWidgetStore((s) => s.sessions);
  const sessionsLoaded = useChatWidgetStore((s) => s.sessionsLoaded);
  const loadSessions = useChatWidgetStore((s) => s.loadSessions);
  const selectSession = useChatWidgetStore((s) => s.selectSession);
  const deleteSession = useChatWidgetStore((s) => s.deleteSession);

  useEffect(() => {
    void loadSessions(currentApp);
  }, [currentApp, loadSessions]);

  if (!sessionsLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <MessageCircle className="h-8 w-8 text-[var(--text-muted)] mb-3" />
        <p className="text-sm text-[var(--text-muted)]">No conversations yet</p>
        <p className="text-xs text-[var(--text-muted)] mt-1">Start a new chat to begin</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
      {sessions.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          onSelect={() => void selectSession(currentApp, session.id)}
          onDelete={() => void deleteSession(currentApp, session.id)}
        />
      ))}
    </div>
  );
}
