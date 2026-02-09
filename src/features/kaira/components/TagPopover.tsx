/**
 * Tag Popover Component
 * Inline editor for adding/removing tags with autocomplete
 */

import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import { cn } from '@/utils';
import { MessageTagBadge } from './MessageTagBadge';
import { TAG_LIMITS } from '@/constants';
import type { TagRegistryItem } from '@/services/storage';

interface TagPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  currentTags: string[];
  allTags: TagRegistryItem[];
  onAddTag: (tag: string) => Promise<void>;
  onRemoveTag: (tag: string) => Promise<void>;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

export function TagPopover({
  isOpen,
  onClose,
  currentTags,
  allTags,
  onAddTag,
  onRemoveTag,
  anchorRef,
}: TagPopoverProps) {
  const [inputValue, setInputValue] = useState('');
  const [filteredTags, setFilteredTags] = useState<TagRegistryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Filter tags based on input
  useEffect(() => {
    if (!inputValue.trim()) {
      // Show all tags not already selected, sorted by usage
      setFilteredTags(
        allTags.filter(t => !currentTags.includes(t.name))
      );
    } else {
      const query = inputValue.toLowerCase();
      setFilteredTags(
        allTags
          .filter(t => 
            t.name.toLowerCase().includes(query) && 
            !currentTags.includes(t.name)
          )
      );
    }
  }, [inputValue, allTags, currentTags]);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current && 
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose, anchorRef]);

  const handleAddTag = async (tagName: string) => {
    const trimmed = tagName.trim();
    if (!trimmed) return;

    if (trimmed.length > TAG_LIMITS.MAX_TAG_LENGTH) {
      setError(`Tag cannot exceed ${TAG_LIMITS.MAX_TAG_LENGTH} characters`);
      return;
    }

    if (currentTags.length >= TAG_LIMITS.MAX_TAGS_PER_MESSAGE) {
      setError(`Maximum ${TAG_LIMITS.MAX_TAGS_PER_MESSAGE} tags allowed`);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await onAddTag(trimmed);
      setInputValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add tag');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag(inputValue);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleRemoveTag = async (tag: string) => {
    setIsLoading(true);
    setError(null);

    try {
      await onRemoveTag(tag);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove tag');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (tagName: string) => {
    handleAddTag(tagName);
  };

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className={cn(
        'absolute z-50 mt-1 w-80 rounded-lg border border-[var(--border-default)]',
        'bg-[var(--bg-primary)] shadow-lg'
      )}
      style={{
        top: anchorRef.current ? anchorRef.current.offsetHeight + 4 : 0,
      }}
    >
      {/* Input Section */}
      <div className="p-3 border-b border-[var(--border-default)]">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type to search or add new tag..."
            disabled={isLoading}
            className={cn(
              'w-full pl-8 pr-3 py-2 text-[13px] rounded border border-[var(--border-default)]',
              'bg-[var(--bg-secondary)] text-[var(--text-primary)]',
              'placeholder:text-[var(--text-muted)]',
              'focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
            maxLength={TAG_LIMITS.MAX_TAG_LENGTH}
          />
        </div>
        {error && (
          <p className="mt-1.5 text-[11px] text-[var(--color-error)]">{error}</p>
        )}
        <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
          Press Enter to add • Max {TAG_LIMITS.MAX_TAGS_PER_MESSAGE} tags
        </p>
      </div>

      {/* Suggestions Section */}
      {filteredTags.length > 0 && (
        <div className="max-h-[200px] overflow-y-auto">
          <div className="px-3 py-1.5 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
            Suggestions
          </div>
          {filteredTags.map((tag) => (
            <button
              key={tag.name}
              onClick={() => handleSuggestionClick(tag.name)}
              disabled={isLoading}
              className={cn(
                'w-full px-3 py-2 text-left text-[13px] flex items-center justify-between',
                'hover:bg-[var(--bg-secondary)] transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <span className="flex items-center gap-2">
                <Plus className="h-3 w-3 text-[var(--text-muted)]" />
                <span className="text-[var(--text-primary)]">{tag.name}</span>
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">
                {tag.count} {tag.count === 1 ? 'use' : 'uses'}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Current Tags Section */}
      {currentTags.length > 0 && (
        <div className="p-3 border-t border-[var(--border-default)]">
          <div className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">
            Current Tags ({currentTags.length}/{TAG_LIMITS.MAX_TAGS_PER_MESSAGE})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {currentTags.map((tag) => (
              <MessageTagBadge
                key={tag}
                tag={tag}
                onRemove={() => handleRemoveTag(tag)}
                removable={!isLoading}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {filteredTags.length === 0 && !inputValue && currentTags.length === 0 && (
        <div className="px-3 py-6 text-center text-[13px] text-[var(--text-muted)]">
          No tags yet. Type to create your first tag.
        </div>
      )}
    </div>
  );
}
