/**
 * Message Tag Badge Component
 * Displays individual tag as a removable pill
 */

import { X } from 'lucide-react';
import { cn } from '@/utils';

interface MessageTagBadgeProps {
  tag: string;
  onRemove?: () => void;
  removable?: boolean;
  className?: string;
}

// Color palette (excluding red/green variants)
const TAG_COLORS = [
  { bg: 'rgb(59 130 246 / 0.1)', text: 'rgb(59 130 246)', border: 'rgb(59 130 246 / 0.2)' }, // blue
  { bg: 'rgb(139 92 246 / 0.1)', text: 'rgb(139 92 246)', border: 'rgb(139 92 246 / 0.2)' }, // violet
  { bg: 'rgb(236 72 153 / 0.1)', text: 'rgb(236 72 153)', border: 'rgb(236 72 153 / 0.2)' }, // pink
  { bg: 'rgb(251 146 60 / 0.1)', text: 'rgb(251 146 60)', border: 'rgb(251 146 60 / 0.2)' }, // orange
  { bg: 'rgb(14 165 233 / 0.1)', text: 'rgb(14 165 233)', border: 'rgb(14 165 233 / 0.2)' }, // sky
  { bg: 'rgb(168 85 247 / 0.1)', text: 'rgb(168 85 247)', border: 'rgb(168 85 247 / 0.2)' }, // purple
  { bg: 'rgb(244 114 182 / 0.1)', text: 'rgb(244 114 182)', border: 'rgb(244 114 182 / 0.2)' }, // fuchsia
  { bg: 'rgb(249 115 22 / 0.1)', text: 'rgb(249 115 22)', border: 'rgb(249 115 22 / 0.2)' }, // amber
  { bg: 'rgb(6 182 212 / 0.1)', text: 'rgb(6 182 212)', border: 'rgb(6 182 212 / 0.2)' }, // cyan
  { bg: 'rgb(99 102 241 / 0.1)', text: 'rgb(99 102 241)', border: 'rgb(99 102 241 / 0.2)' }, // indigo
];

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
 * Get deterministic color for a tag name
 */
function getTagColor(tag: string) {
  const index = hashString(tag) % TAG_COLORS.length;
  return TAG_COLORS[index];
}

export function MessageTagBadge({ tag, onRemove, removable = true, className }: MessageTagBadgeProps) {
  const color = getTagColor(tag);
  
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium',
        'transition-colors',
        className
      )}
      style={{
        backgroundColor: color.bg,
        color: color.text,
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: color.border,
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
