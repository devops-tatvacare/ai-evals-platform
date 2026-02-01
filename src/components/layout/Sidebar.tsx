import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { Plus, Search, PanelLeftClose, PanelLeft, Settings, Pencil, Trash2, Check, X } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, Input, Badge, Modal } from '@/components/ui';
import { useListingsStore, useUIStore } from '@/stores';
import { listingsRepository } from '@/services/storage';
import { useDebounce } from '@/hooks';
import { cn } from '@/utils';
import { formatDate } from '@/utils';
import type { Listing } from '@/types';

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
  const { listings, searchQuery, setSearchQuery, selectedId, updateListing, removeListing } = useListingsStore();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const debouncedSearch = useDebounce(searchQuery, 300);
  
  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Listing | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const filteredListings = debouncedSearch
    ? listings.filter((l) => 
        l.title.toLowerCase().includes(debouncedSearch.toLowerCase())
      )
    : listings;

  const handleRename = useCallback(async (id: string, newTitle: string) => {
    await listingsRepository.update(id, { title: newTitle });
    updateListing(id, { title: newTitle });
  }, [updateListing]);

  const handleDeleteClick = useCallback((listing: Listing) => {
    setDeleteTarget(listing);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    
    setIsDeleting(true);
    try {
      await listingsRepository.delete(deleteTarget.id);
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
  }, [deleteTarget, removeListing, location.pathname, navigate]);

  const handleCancelDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);

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
          <Button size="sm" onClick={onNewEval} className="h-9 w-9 p-0" title="New evaluation">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="border-t border-[var(--border-subtle)] p-2">
          <Link
            to="/settings"
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-[6px] transition-colors',
              location.pathname === '/settings'
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
      <aside className="flex h-screen w-[260px] flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] px-4">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Voice RX</h1>
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={onNewEval}>
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

        <div className="p-3">
          <Input
            placeholder="Search evaluations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            icon={<Search className="h-4 w-4" />}
          />
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {filteredListings.length === 0 ? (
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

        <div className="border-t border-[var(--border-subtle)] p-3">
          <Link
            to="/settings"
            className={cn(
              'flex items-center gap-2 rounded-[6px] px-3 py-2 text-[13px] font-medium transition-colors',
              location.pathname === '/settings'
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
