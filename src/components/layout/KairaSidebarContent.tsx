/**
 * Kaira Sidebar Content
 * Displays chat sessions for Kaira Bot in the sidebar
 */

import { useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui';
import { ChatSessionList } from '@/features/kaira/components/ChatSessionList';
import { useKairaChat } from '@/hooks';
import { useDebounce } from '@/hooks';

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
    if (location.pathname !== '/kaira') {
      navigate('/kaira');
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
