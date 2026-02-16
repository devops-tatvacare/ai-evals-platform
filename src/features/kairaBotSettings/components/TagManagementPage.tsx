/**
 * Tag Management Page
 * Global tag management for Kaira Bot messages
 */

import { useState, useEffect } from 'react';
import { Tag, Trash2, Edit2, Check, X } from 'lucide-react';
import { cn } from '@/utils';
import { tagRegistryRepository, chatMessagesRepository, type TagRegistryItem } from '@/services/storage';
import { notificationService } from '@/services/notifications';
import { Spinner, Alert, EmptyState } from '@/components/ui';

interface EditingTag {
  originalName: string;
  newName: string;
}

export function TagManagementPage() {
  const [tags, setTags] = useState<TagRegistryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingTag, setEditingTag] = useState<EditingTag | null>(null);
  const [deletingTag, setDeletingTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load tags on mount
  useEffect(() => {
    loadTags();
  }, []);

  const loadTags = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const allTags = await tagRegistryRepository.getAllTags('kaira-bot');
      setTags(allTags);
    } catch (err) {
      console.error('Failed to load tags:', err);
      setError(err instanceof Error ? err.message : 'Failed to load tags');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartEdit = (tag: TagRegistryItem) => {
    setEditingTag({ originalName: tag.name, newName: tag.name });
  };

  const handleCancelEdit = () => {
    setEditingTag(null);
  };

  const handleSaveEdit = async () => {
    if (!editingTag) return;

    const trimmed = editingTag.newName.trim();
    if (!trimmed) {
      notificationService.error('Tag name cannot be empty');
      return;
    }

    if (trimmed === editingTag.originalName) {
      setEditingTag(null);
      return;
    }

    try {
      // Rename in registry
      await tagRegistryRepository.renameTag('kaira-bot', editingTag.originalName, trimmed);
      
      // Rename in all messages
      await chatMessagesRepository.renameTagInAllMessages(editingTag.originalName, trimmed);

      notificationService.success('Tag renamed successfully');
      setEditingTag(null);
      await loadTags();
    } catch (err) {
      console.error('Failed to rename tag:', err);
      notificationService.error(err instanceof Error ? err.message : 'Failed to rename tag');
    }
  };

  const handleDelete = async (tagName: string) => {
    if (!confirm(`Delete tag "${tagName}"? This will remove it from all messages.`)) {
      return;
    }

    setDeletingTag(tagName);

    try {
      // Delete from all messages
      await chatMessagesRepository.deleteTagFromAllMessages(tagName);
      
      // Delete from registry
      await tagRegistryRepository.deleteTag('kaira-bot', tagName);

      notificationService.success('Tag deleted successfully');
      await loadTags();
    } catch (err) {
      console.error('Failed to delete tag:', err);
      notificationService.error(err instanceof Error ? err.message : 'Failed to delete tag');
    } finally {
      setDeletingTag(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Alert variant="error">{error}</Alert>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Tag Management</h1>
        <p className="text-[14px] text-[var(--text-muted)]">
          Manage tags used for annotating Kaira Bot messages. Renaming or deleting tags will update all messages.
        </p>
      </div>

      {/* Tags List */}
      {tags.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No tags yet"
          description="Add tags to messages from the chat view."
        />
      ) : (
        <div className="border border-[var(--border-default)] rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-[var(--bg-secondary)] border-b border-[var(--border-default)]">
              <tr>
                <th className="px-4 py-3 text-left text-[12px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                  Tag Name
                </th>
                <th className="px-4 py-3 text-left text-[12px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                  Usage Count
                </th>
                <th className="px-4 py-3 text-left text-[12px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                  Last Used
                </th>
                <th className="px-4 py-3 text-right text-[12px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]">
              {tags.map((tag) => {
                const isEditing = editingTag?.originalName === tag.name;
                const isDeleting = deletingTag === tag.name;

                return (
                  <tr
                    key={tag.name}
                    className={cn(
                      'bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)] transition-colors',
                      (isDeleting || isEditing) && 'bg-[var(--bg-secondary)]'
                    )}
                  >
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editingTag.newName}
                          onChange={(e) => setEditingTag({ ...editingTag, newName: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit();
                            if (e.key === 'Escape') handleCancelEdit();
                          }}
                          className={cn(
                            'w-full px-2 py-1 text-[13px] rounded border border-[var(--border-default)]',
                            'bg-[var(--bg-primary)] text-[var(--text-primary)]',
                            'focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]'
                          )}
                          autoFocus
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <Tag className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                          <span className="text-[13px] text-[var(--text-primary)] font-mono">
                            {tag.name}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[var(--text-secondary)]">
                      {tag.count} {tag.count === 1 ? 'message' : 'messages'}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[var(--text-secondary)]">
                      {new Date(tag.lastUsed).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={handleSaveEdit}
                            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--color-success)] transition-colors"
                            title="Save"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] transition-colors"
                            title="Cancel"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleStartEdit(tag)}
                            disabled={isDeleting}
                            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-brand)] transition-colors disabled:opacity-50"
                            title="Rename tag"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(tag.name)}
                            disabled={isDeleting}
                            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--color-error)] transition-colors disabled:opacity-50"
                            title="Delete tag"
                          >
                            {isDeleting ? (
                              <Spinner size="sm" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
