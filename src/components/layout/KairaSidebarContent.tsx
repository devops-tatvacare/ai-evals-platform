/**
 * Kaira Sidebar Content
 * Displays chat sessions for Kaira Bot in the sidebar
 */

import { useState, useCallback } from 'react';
import { useLocation, useNavigate, NavLink } from 'react-router-dom';
import { Search, LayoutDashboard, ListChecks, ScrollText } from 'lucide-react';
import { Input } from '@/components/ui';
import { ChatSessionList } from '@/features/kaira/components/ChatSessionList';
import { useKairaChat } from '@/hooks';
import { useDebounce } from '@/hooks';
import { cn } from '@/utils';
import { routes } from '@/config/routes';

interface KairaSidebarContentProps {
  searchPlaceholder: string;
}

export function KairaSidebarContent({ searchPlaceholder }: KairaSidebarContentProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const location = useLocation();
  const navigate = useNavigate();

  const {
    sessions,
    currentSession,
    selectSession,
    deleteSession,
    updateSessionTitle,
  } = useKairaChat();

  // Filter sessions based on search
  const filteredSessions = debouncedSearch
    ? sessions.filter((s) => 
        s.title.toLowerCase().includes(debouncedSearch.toLowerCase())
      )
    : sessions;

  const handleSelectSession = useCallback((sessionId: string) => {
    selectSession(sessionId);
    // Navigate to chat view if not already there
    if (location.pathname !== routes.kaira.home) {
      navigate(routes.kaira.home);
    }
  }, [selectSession, location.pathname, navigate]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    deleteSession(sessionId);
  }, [deleteSession]);

  const handleRenameSession = useCallback((sessionId: string, newTitle: string) => {
    updateSessionTitle(sessionId, newTitle);
  }, [updateSessionTitle]);

  return (
    <>
      {/* Eval nav links */}
      <nav className="px-2 pt-2 pb-1 space-y-0.5">
        <KairaNavLink to={routes.kaira.dashboard} icon={LayoutDashboard} label="Dashboard" />
        <KairaNavLink to={routes.kaira.runs} icon={ListChecks} label="Runs" />
        <KairaNavLink to={routes.kaira.logs} icon={ScrollText} label="Logs" />
      </nav>

      <div className="border-t border-[var(--border-subtle)] mx-3" />

      {/* Existing search + sessions */}
      <div className="p-3">
        <Input
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          icon={<Search className="h-4 w-4" />}
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <ChatSessionList
          sessions={filteredSessions}
          currentSessionId={currentSession?.id ?? null}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
        />
      </nav>
    </>
  );
}

function KairaNavLink({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-[6px] px-3 py-2 text-[13px] font-medium transition-colors',
          isActive
            ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]'
        )
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </NavLink>
  );
}
