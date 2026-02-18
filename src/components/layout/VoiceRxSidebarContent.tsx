/**
 * Voice RX Sidebar Content
 * Mirrors KairaSidebarContent: nav links (Dashboard, Runs, Logs) + search + recordings listing.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { Search, LayoutDashboard, ListChecks, ScrollText, Pencil, Trash2, Check, X, Mic } from 'lucide-react';
import { Input, Badge, Skeleton, Modal, Button, EmptyState } from '@/components/ui';
import { useListingsStore, useAppStore } from '@/stores';
import { listingsRepository } from '@/services/storage';
import { useDebounce, useCurrentListings, useCurrentListingsActions } from '@/hooks';
import { cn, formatDate } from '@/utils';
import { routes } from '@/config/routes';
import type { Listing } from '@/types';

interface VoiceRxSidebarContentProps {
  searchPlaceholder: string;
}

export function VoiceRxSidebarContent({ searchPlaceholder }: VoiceRxSidebarContentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const appId = useAppStore((state) => state.currentApp);
  const listings = useCurrentListings();
  const { updateListing, removeListing } = useCurrentListingsActions();
  const { searchQuery, setSearchQuery, selectedId } = useListingsStore();
  const isLoadingListings = useListingsStore((state) => state.isLoading);
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

      if (location.pathname === routes.voiceRx.listing(deleteTarget.id)) {
        navigate(routes.voiceRx.home);
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

  return (
    <>
      {/* Nav links */}
      <nav className="px-2 pt-2 pb-1 space-y-0.5">
        <VoiceRxNavLink to={routes.voiceRx.dashboard} icon={LayoutDashboard} label="Dashboard" />
        <VoiceRxNavLink to={routes.voiceRx.runs} icon={ListChecks} label="Runs" />
        <VoiceRxNavLink to={routes.voiceRx.logs} icon={ScrollText} label="Logs" />
      </nav>

      <div className="border-t border-[var(--border-subtle)] mx-3" />

      {/* Search */}
      <div className="p-3">
        <Input
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          icon={<Search className="h-4 w-4" />}
        />
      </div>

      {/* Recordings list */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {isLoadingListings ? (
          <div className="space-y-1 px-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-[6px]" />
            ))}
          </div>
        ) : filteredListings.length === 0 ? (
          <div className="px-2 py-6">
            <EmptyState
              icon={searchQuery ? Search : Mic}
              title={searchQuery ? 'No matching evaluations' : 'No evaluations yet'}
              description={searchQuery ? 'Try a different search term.' : 'Create a new evaluation to get started.'}
              compact
            />
          </div>
        ) : (
          <ul className="space-y-1">
            {filteredListings.map((listing) => (
              <li key={listing.id}>
                <SidebarItem
                  listing={listing}
                  isSelected={selectedId === listing.id || location.pathname === routes.voiceRx.listing(listing.id)}
                  onRename={handleRename}
                  onDelete={handleDeleteClick}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>

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

/* ── Nav Link ──────────────────────────────────────────────────── */

function VoiceRxNavLink({
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

/* ── Sidebar Item (recording entry) ───────────────────────────── */

function SidebarItem({
  listing,
  isSelected,
  onRename,
  onDelete,
}: {
  listing: Listing;
  isSelected: boolean;
  onRename: (id: string, newTitle: string) => Promise<void>;
  onDelete: (listing: Listing) => void;
}) {
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

  const getStatusBadge = (status: string) => {
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
            className="shrink-0 p-1 rounded text-[var(--color-success)] hover:bg-[var(--color-success)]/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
            title="Save"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            onClick={handleCancelEdit}
            disabled={isSaving}
            className="shrink-0 p-1 rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
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
        to={routes.voiceRx.listing(listing.id)}
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
          className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
          title="Rename"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleDeleteClick}
          className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
