/**
 * Action Chips Component
 * Parses and renders interactive action chips from Kaira responses
 * 
 * Chip syntax: <chip id="..." label="..." type="action" variant="kaira|kaira-outline" />
 */

import { useCallback } from 'react';
import { cn } from '@/utils';

interface ChipData {
  id: string;
  label: string;
  type: string;
  variant: string;
}

interface ActionChipsProps {
  content: string;
  onChipClick?: (chipId: string, chipLabel: string) => void;
}

// Regex to match chip tags
const CHIP_REGEX = /<chip\s+id="([^"]+)"\s+label="([^"]+)"\s+type="([^"]+)"\s+variant="([^"]+)"\s*\/>/g;

/**
 * Check if content contains chips
 */
export function hasChips(content: string): boolean {
  CHIP_REGEX.lastIndex = 0;
  return CHIP_REGEX.test(content);
}

/**
 * Remove chips from content (for markdown rendering)
 */
export function removeChips(content: string): string {
  // Remove chips and clean up extra whitespace/newlines
  return content
    .replace(CHIP_REGEX, '')
    .replace(/\n{3,}/g, '\n\n') // Replace 3+ newlines with 2
    .trim();
}

/**
 * Get default label for chip ID
 */
function getDefaultLabel(chipId: string): string {
  const labels: Record<string, string> = {
    'confirm_log': '✅ Yes, log this meal',
    'edit_meal': '✏️ No, edit this meal',
    'confirm': '✅ Confirm',
    'cancel': '❌ Cancel',
    'yes': '✅ Yes',
    'no': '❌ No',
  };
  return labels[chipId] || chipId;
}

/**
 * Extract only the chips from content
 */
export function extractChips(content: string): ChipData[] {
  const chips: ChipData[] = [];
  let match;
  
  CHIP_REGEX.lastIndex = 0;
  while ((match = CHIP_REGEX.exec(content)) !== null) {
    const chipId = match[1];
    const chipLabel = match[2] || getDefaultLabel(chipId); // Use default if empty
    
    chips.push({
      id: chipId,
      label: chipLabel,
      type: match[3],
      variant: match[4],
    });
  }
  
  return chips;
}

/**
 * Render a single action chip
 */
function ActionChip({ 
  chip, 
  onClick 
}: { 
  chip: ChipData; 
  onClick?: (id: string, label: string) => void;
}) {
  const handleClick = useCallback(() => {
    onClick?.(chip.id, chip.label);
  }, [chip.id, chip.label, onClick]);

  const isPrimary = chip.variant === 'kaira';
  const isOutline = chip.variant === 'kaira-outline';

  return (
    <button
      onClick={handleClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-semibold transition-all',
        'focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[var(--color-brand-accent)]',
        'shadow-sm hover:shadow-md active:scale-[0.98]',
        isPrimary && [
          'bg-[var(--color-brand-accent)] text-white',
          'hover:bg-[var(--color-brand-accent)]/90',
          'active:bg-[var(--color-brand-accent)]/80',
        ],
        isOutline && [
          'bg-white dark:bg-[var(--bg-primary)] text-[var(--color-brand-accent)]',
          'border-2 border-[var(--color-brand-accent)]',
          'hover:bg-[var(--color-brand-accent)]/10',
          'active:bg-[var(--color-brand-accent)]/20',
        ],
        !isPrimary && !isOutline && [
          'bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-default)]',
          'hover:bg-[var(--bg-tertiary)]/80 hover:border-[var(--border-focus)]',
        ]
      )}
    >
      {chip.label}
    </button>
  );
}

/**
 * Render action chips from content
 */
export function ActionChips({ content, onChipClick }: ActionChipsProps) {
  const chips = extractChips(content);

  if (chips.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {chips.map((chip) => (
        <ActionChip 
          key={chip.id} 
          chip={chip} 
          onClick={onChipClick} 
        />
      ))}
    </div>
  );
}
