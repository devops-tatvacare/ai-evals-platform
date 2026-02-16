import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { Plus, Search, PanelLeftClose, PanelLeft, Settings, Pencil, Trash2, Check, X, LayoutDashboard, ListChecks, ScrollText } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, Input, Badge, Modal, Skeleton } from '@/components/ui';
import { useListingsStore, useUIStore, useAppStore, useChatStore, useKairaBotSettings } from '@/stores';
import { listingsRepository } from '@/services/storage';
import { useDebounce, useCurrentListings, useCurrentAppMetadata, useCurrentListingsActions } from '@/hooks';
import { cn } from '@/utils';
import { formatDate } from '@/utils';
import type { Listing } from '@/types';
import { AppSwitcher } from './AppSwitcher';
import { KairaSidebarContent } from './KairaSidebarContent';

interface SidebarProps {
  onNewEval?: () => void;
}

interface SidebarItemProps {
  listing: Listing;
  isSelected: boolean;
  onRename: (id: string, newTitle: string) => Promise<void>;
  onDelete: (listing: Listing) => void;
}

function SidebarItem({ listing, isSelected, onRename, onDelete }: SidebarItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(listing.title);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditValue(listing.title);
    setIsEditing(true);
  }, [listing.title]);

  const handleSaveEdit = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === listing.title) {
      setIsEditing(false);
      setEditValue(listing.title);
      return;
    }
    
    setIsSaving(true);
    try {
      await onRename(listing.id, trimmed);
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to rename:', err);
      setEditValue(listing.title);
    } finally {
      setIsSaving(false);
    }
  }, [editValue, listing.id, listing.title, onRename]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditValue(listing.title);
  }, [listing.title]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  }, [handleSaveEdit, handleCancelEdit]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete(listing);
  }, [listing, onDelete]);

  const getStatusBadge = (status: string): ReactNode => {
    switch (status) {
      case 'completed':
        return <Badge variant="success">Done</Badge>;
      case 'processing':
        return <Badge variant="primary">Processing</Badge>;
      default:
        return <Badge variant="neutral">Draft</Badge>;
    }
  };

  if (isEditing) {
    return (
      <div className="rounded-[6px] px-2 py-2 bg-[var(--bg-elevated)] border border-[var(--border-focus)]">
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSaveEdit}
            disabled={isSaving}
            className="flex-1 min-w-0 h-7 px-2 text-[13px] rounded border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
          />
          <button
            onClick={handleSaveEdit}
            disabled={isSaving}
            className="shrink-0 p-1 rounded text-[var(--color-success)] hover:bg-[var(--color-success)]/10"
            title="Save"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            onClick={handleCancelEdit}
            disabled={isSaving}
            className="shrink-0 p-1 rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]"
            title="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative">
      <Link
        to={`/listing/${listing.id}`}
        className={cn(
          'block rounded-[6px] px-3 py-2 pr-16 transition-colors',
          isSelected
            ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
            : 'text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)]'
        )}
      >
        <div className="flex items-center justify-between">
          <span className="truncate text-[13px] font-medium">{listing.title}</span>
          {getStatusBadge(listing.status)}
        </div>
        <div className="mt-1 text-[11px] text-[var(--text-muted)]">
          {formatDate(listing.updatedAt)}
        </div>
      </Link>
      
      {/* Action buttons - visible on hover */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleStartEdit}
          className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
          title="Rename"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleDeleteClick}
          className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function Sidebar({ onNewEval }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const appId = useAppStore((state) => state.currentApp);
  const appMetadata = useCurrentAppMetadata();
  const listings = useCurrentListings();
  const { updateListing, removeListing } = useCurrentListingsActions();
  const { searchQuery, setSearchQuery, selectedId } = useListingsStore();
  const isLoadingListings = useListingsStore((state) => state.isLoading);
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const debouncedSearch = useDebounce(searchQuery, 300);
  
  // Kaira chat specific
  const { createSession, selectSession, isCreatingSession, isStreaming } = useChatStore();
  const { settings: kairaBotSettings } = useKairaBotSettings();
  const kairaChatUserId = kairaBotSettings.kairaChatUserId;
  
  // Compute settings path based on current app
  const settingsPath = appId === 'kaira-bot' ? '/kaira/settings' : '/settings';
  const isSettingsActive = location.pathname === '/settings' || location.pathname === '/kaira/settings';
  
  // Check if this is Kaira Bot app
  const isKairaBot = appId === 'kaira-bot';
  
  // Disable new button when creating session or streaming
  const isNewButtonDisabled = isKairaBot && (!kairaChatUserId || isCreatingSession || isStreaming);
  
  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Listing | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const filteredListings = debouncedSearch
    ? listings.filter((l) => 
        l.title.toLowerCase().includes(debouncedSearch.toLowerCase())
      )
    : listings;

  const handleRename = useCallback(async (id: string, newTitle: string) => {
    await listingsRepository.update(appId, id, { title: newTitle });
    updateListing(id, { title: newTitle });
  }, [appId, updateListing]);

  const handleDeleteClick = useCallback((listing: Listing) => {
    setDeleteTarget(listing);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    
    setIsDeleting(true);
    try {
      await listingsRepository.delete(appId, deleteTarget.id);
      removeListing(deleteTarget.id);
      
      // Navigate away if we deleted the currently viewed listing
      if (location.pathname === `/listing/${deleteTarget.id}`) {
        navigate('/');
      }
      
      setDeleteTarget(null);
    } catch (err) {
      console.error('Failed to delete listing:', err);
    } finally {
      setIsDeleting(false);
    }
  }, [appId, deleteTarget, removeListing, location.pathname, navigate]);

  const handleCancelDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  // Handle new button click - different behavior for Kaira vs Voice Rx
  const handleNewClick = useCallback(async () => {
    if (isKairaBot && kairaChatUserId) {
      // Guard handled by store, but also check here for early return
      if (isCreatingSession || isStreaming) return;
      
      try {
        // Create new Kaira chat session
        const session = await createSession(appId, kairaChatUserId);
        selectSession(appId, session.id);
        // Navigate to Kaira chat if not on the main chat page
        if (location.pathname !== '/kaira') {
          navigate('/kaira');
        }
      } catch (err) {
        // Session creation failed (likely concurrent creation guard)
        console.warn('Session creation skipped:', err);
      }
    } else if (!isKairaBot && onNewEval) {
      // Voice Rx - use existing handler
      onNewEval();
    }
  }, [isKairaBot, kairaChatUserId, isCreatingSession, isStreaming, appId, createSession, selectSession, location.pathname, navigate, onNewEval]);

  // Collapsed sidebar
  if (sidebarCollapsed) {
    return (
      <aside className="flex h-screen w-14 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="flex h-14 items-center justify-center border-b border-[var(--border-subtle)]">
          <button
            onClick={toggleSidebar}
            className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]"
            title="Expand sidebar"
          >
            <PanelLeft className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center py-3 gap-2">
          <Button
            size="sm"
            onClick={handleNewClick}
            disabled={isNewButtonDisabled}
            className="h-9 w-9 p-0"
            title={isKairaBot ? "New chat" : "New evaluation"}
          >
            <Plus className="h-4 w-4" />
          </Button>

          {isKairaBot && (
            <>
              <div className="border-t border-[var(--border-subtle)] w-8 my-1" />
              <CollapsedNavLink to="/kaira/dashboard" icon={LayoutDashboard} title="Dashboard" />
              <CollapsedNavLink to="/kaira/runs" icon={ListChecks} title="Runs" />
              <CollapsedNavLink to="/kaira/logs" icon={ScrollText} title="Logs" />
            </>
          )}
        </div>
        <div className="border-t border-[var(--border-subtle)] p-2">
          <Link
            to={settingsPath}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-[6px] transition-colors',
              isSettingsActive
                ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]'
            )}
            title="Settings"
          >
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </aside>
    );
  }

  return (
    <>
      <aside className="flex h-screen w-[280px] flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] px-4">
          <AppSwitcher />
          <div className="flex items-center gap-1">
            <Button 
              size="sm" 
              onClick={handleNewClick}
              disabled={isNewButtonDisabled}
              isLoading={isCreatingSession}
            >
              <Plus className="h-4 w-4" />
              New
            </Button>
            <button
              onClick={toggleSidebar}
              className="ml-1 rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Conditional content based on app */}
        {isKairaBot ? (
          <KairaSidebarContent searchPlaceholder={appMetadata.searchPlaceholder} />
        ) : (
          <>
            <div className="p-3">
              <Input
                placeholder={appMetadata.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                icon={<Search className="h-4 w-4" />}
              />
            </div>

            <nav className="flex-1 overflow-y-auto px-2 pb-4">
              {isLoadingListings ? (
                <div className="space-y-1 px-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-9 w-full rounded-[6px]" />
                  ))}
                </div>
              ) : filteredListings.length === 0 ? (
                <div className="px-2 py-8 text-center text-[13px] text-[var(--text-muted)]">
                  {searchQuery ? 'No matching evaluations' : 'No evaluations yet'}
                </div>
              ) : (
                <ul className="space-y-1">
                  {filteredListings.map((listing) => (
                    <li key={listing.id}>
                      <SidebarItem
                        listing={listing}
                        isSelected={selectedId === listing.id || location.pathname === `/listing/${listing.id}`}
                        onRename={handleRename}
                        onDelete={handleDeleteClick}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </nav>
          </>
        )}

        <div className="border-t border-[var(--border-subtle)] p-3">
          <Link
            to={settingsPath}
            className={cn(
              'flex items-center gap-2 rounded-[6px] px-3 py-2 text-[13px] font-medium transition-colors',
              isSettingsActive
                ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </div>
      </aside>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={handleCancelDelete}
        title="Delete Evaluation"
        className="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-[13px] text-[var(--text-secondary)]">
            Are you sure you want to delete <strong className="text-[var(--text-primary)]">"{deleteTarget?.title}"</strong>?
          </p>
          <p className="text-[12px] text-[var(--text-muted)]">
            This will permanently delete the evaluation and all associated files (audio, transcript, etc.). This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={handleCancelDelete}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirmDelete}
              isLoading={isDeleting}
              className="bg-[var(--color-error)] hover:bg-[var(--color-error)]/90"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function CollapsedNavLink({
  to,
  icon: Icon,
  title,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  const location = useLocation();
  const isActive = location.pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-[6px] transition-colors',
        isActive
          ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]'
      )}
      title={title}
    >
      <Icon className="h-5 w-5" />
    </Link>
  );
}
