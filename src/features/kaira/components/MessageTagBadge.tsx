/**
 * Message Tag Badge Component
 * Displays individual tag as a removable pill
 */

import { X } from 'lucide-react';
import { cn } from '@/utils';
import { TAG_ACCENT_COLORS } from '@/utils/statusColors';

interface MessageTagBadgeProps {
  tag: string;
  onRemove?: () => void;
  removable?: boolean;
  className?: string;
}

/**
 * Simple hash function for consistent color assignment
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Get deterministic accent color CSS var for a tag name
 */
function getTagAccentColor(tag: string): string {
  const index = hashString(tag) % TAG_ACCENT_COLORS.length;
  return TAG_ACCENT_COLORS[index];
}

export function MessageTagBadge({ tag, onRemove, removable = true, className }: MessageTagBadgeProps) {
  const accentColor = getTagAccentColor(tag);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium',
        'transition-colors',
        className
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${accentColor} 10%, transparent)`,
        color: accentColor,
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: `color-mix(in srgb, ${accentColor} 20%, transparent)`,
      }}
    >
      <span className="max-w-[150px] truncate" title={tag}>#{tag}</span>
      {removable && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:opacity-70 transition-opacity"
          aria-label={`Remove tag ${tag}`}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}
