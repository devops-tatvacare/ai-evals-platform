/**
 * Chat Session List Component
 * Displays list of chat sessions in sidebar
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { MessageSquare, Pencil, Trash2, Check, X } from 'lucide-react';
import { cn, formatDate } from '@/utils';
import { Modal, Button } from '@/components/ui';
import type { KairaChatSession } from '@/types';

interface ChatSessionListProps {
  sessions: KairaChatSession[];
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, newTitle: string) => void;
}

interface SessionItemProps {
  session: KairaChatSession;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
}

function SessionItem({ 
  session, 
  isSelected, 
  onSelect, 
  onDelete, 
  onRename 
}: SessionItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(session.title);
    setIsEditing(true);
  }, [session.title]);

  const handleSaveEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.title) {
      onRename(trimmed);
    }
    setIsEditing(false);
  }, [editValue, session.title, onRename]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditValue(session.title);
  }, [session.title]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  }, [handleSaveEdit, handleCancelEdit]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  }, [onDelete]);

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
            className="flex-1 min-w-0 h-7 px-2 text-[13px] rounded border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
          />
          <button
            onClick={handleSaveEdit}
            className="shrink-0 p-1 rounded text-[var(--color-success)] hover:bg-[var(--color-success)]/10"
            title="Save"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            onClick={handleCancelEdit}
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
      <button
        onClick={onSelect}
        className={cn(
          'w-full text-left block rounded-[6px] px-3 py-2 pr-16 transition-colors',
          isSelected
            ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
            : 'text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)]'
        )}
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 shrink-0 opacity-60" />
          <span className="truncate text-[13px] font-medium">{session.title}</span>
        </div>
        <div className="mt-1 text-[11px] text-[var(--text-muted)] pl-6">
          {formatDate(session.updatedAt)}
        </div>
      </button>
      
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

export function ChatSessionList({
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
}: ChatSessionListProps) {
  const [deleteTarget, setDeleteTarget] = useState<KairaChatSession | null>(null);

  const handleConfirmDelete = useCallback(() => {
    if (deleteTarget) {
      onDeleteSession(deleteTarget.id);
      setDeleteTarget(null);
    }
  }, [deleteTarget, onDeleteSession]);

  if (sessions.length === 0) {
    return (
      <div className="px-2 py-8 text-center text-[13px] text-[var(--text-muted)]">
        No chats yet
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-1">
        {sessions.map((session) => (
          <li key={session.id}>
            <SessionItem
              session={session}
              isSelected={currentSessionId === session.id}
              onSelect={() => onSelectSession(session.id)}
              onDelete={() => setDeleteTarget(session)}
              onRename={(title) => onRenameSession(session.id, title)}
            />
          </li>
        ))}
      </ul>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Chat"
        className="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-[13px] text-[var(--text-secondary)]">
            Are you sure you want to delete <strong className="text-[var(--text-primary)]">"{deleteTarget?.title}"</strong>?
          </p>
          <p className="text-[12px] text-[var(--text-muted)]">
            This will permanently delete the chat and all messages. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirmDelete}
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
