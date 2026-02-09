/**
 * Message Tags Component
 * Displays tags with collapsed/expanded states and edit popover
 */

import { useState, useRef } from 'react';
import { Tag } from 'lucide-react';
import { cn } from '@/utils';
import { MessageTagBadge } from './MessageTagBadge';
import { TagPopover } from './TagPopover';
import type { TagRegistryItem } from '@/services/storage';

interface MessageTagsProps {
  currentTags: string[];
  allTags: TagRegistryItem[];
  onAddTag: (tag: string) => Promise<void>;
  onRemoveTag: (tag: string) => Promise<void>;
  className?: string;
}

const MAX_VISIBLE_TAGS = 2;

export function MessageTags({
  currentTags,
  allTags,
  onAddTag,
  onRemoveTag,
  className,
}: MessageTagsProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const visibleTags = currentTags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenTagsCount = currentTags.length - MAX_VISIBLE_TAGS;
  const hasHiddenTags = hiddenTagsCount > 0;

  const handleTogglePopover = () => {
    setIsPopoverOpen(!isPopoverOpen);
    setIsTooltipVisible(false);
  };

  return (
    <div className={cn('relative inline-flex items-center gap-1.5', className)}>
      {/* Add Tag Button */}
      <button
        ref={buttonRef}
        onClick={handleTogglePopover}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px]',
          'text-[var(--text-muted)] hover:text-[var(--text-brand)] hover:bg-[var(--bg-tertiary)]',
          'transition-colors',
          isPopoverOpen && 'text-[var(--text-brand)] bg-[var(--bg-tertiary)]'
        )}
        title="Add or manage tags"
      >
        <Tag className="h-3 w-3" />
        <span>Tag</span>
      </button>

      {/* Visible Tags */}
      {visibleTags.length > 0 && (
        <div className="inline-flex items-center gap-1">
          {visibleTags.map((tag) => (
            <MessageTagBadge
              key={tag}
              tag={tag}
              removable={false}
            />
          ))}

          {/* +N More Badge with Tooltip */}
          {hasHiddenTags && (
            <div
              className="relative"
              onMouseEnter={() => setIsTooltipVisible(true)}
              onMouseLeave={() => setIsTooltipVisible(false)}
            >
              <span
                className={cn(
                  'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium cursor-help',
                  'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                )}
              >
                +{hiddenTagsCount} more
              </span>

              {/* Tooltip */}
              {isTooltipVisible && (
                <div
                  className={cn(
                    'absolute z-50 top-full mt-1 left-0',
                    'min-w-max max-w-xs p-2 rounded-lg border border-[var(--border-default)]',
                    'bg-[var(--bg-primary)] shadow-lg'
                  )}
                >
                  <div className="flex flex-wrap gap-1">
                    {currentTags.slice(MAX_VISIBLE_TAGS).map((tag) => (
                      <MessageTagBadge
                        key={tag}
                        tag={tag}
                        removable={false}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tag Popover */}
      <TagPopover
        isOpen={isPopoverOpen}
        onClose={() => setIsPopoverOpen(false)}
        currentTags={currentTags}
        allTags={allTags}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
        anchorRef={buttonRef}
      />
    </div>
  );
}
