import { useState } from 'react';
import { Undo2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/utils/cn';
import { useReviewModeStore } from '@/stores/reviewModeStore';
import { NoteModal } from './NoteModal';
import type { ReviewableItem, ReviewableAttribute } from '@/types/reviews';
import type { InlineEditState } from '@/features/reviews/inline/types';

interface RuleReviewProps {
  item: ReviewableItem;
  attr: ReviewableAttribute;
  edit: InlineEditState | undefined;
}

export function RuleReviewStatus({ item, attr, edit }: RuleReviewProps) {
  const correctAttribute = useReviewModeStore((s) => s.correctAttribute);
  const isOverridden = edit?.decision === 'correct' && edit.reviewedValue != null;
  const currentValue = isOverridden ? edit.reviewedValue : attr.originalValue;

  return (
    <select
      value={currentValue ?? ''}
      onChange={(e) => correctAttribute(item, attr, e.target.value)}
      className={cn(
        'text-xs rounded border px-1.5 py-0.5 bg-[var(--bg-secondary)] text-[var(--text-primary)]',
        'focus:outline-none focus:border-[var(--border-brand)]',
        isOverridden && 'border-[var(--color-warning)] ring-1 ring-[var(--color-warning)]',
        !isOverridden && 'border-[var(--border-default)]',
      )}
    >
      {attr.allowedValues.map((v) => (
        <option key={v} value={v}>{v}</option>
      ))}
    </select>
  );
}

export function RuleReviewActions({ item, attr, edit }: RuleReviewProps) {
  const clearAttribute = useReviewModeStore((s) => s.clearAttribute);
  const setAttributeNote = useReviewModeStore((s) => s.setAttributeNote);
  const [noteOpen, setNoteOpen] = useState(false);

  const isOverridden = edit?.decision === 'correct' && edit.reviewedValue != null;
  const hasNote = !!edit?.note;

  return (
    <div className="flex items-center gap-1">
      {isOverridden && (
        <Button
          variant="ghost"
          size="sm"
          icon={Undo2}
          onClick={() => clearAttribute(item, attr)}
          title="Undo override"
          className="h-6 w-6 p-0"
        />
      )}
      <Button
        variant="ghost"
        size="sm"
        icon={MessageCircle}
        onClick={() => setNoteOpen(true)}
        title={hasNote ? 'Edit note' : 'Add note'}
        className={cn('h-6 w-6 p-0', hasNote && 'text-[var(--color-brand-primary)]')}
      />
      {noteOpen && (
        <NoteModal
          initialNote={edit?.note ?? ''}
          onSave={(note) => {
            setAttributeNote(item, attr, note || null);
            setNoteOpen(false);
          }}
          onClose={() => setNoteOpen(false)}
        />
      )}
    </div>
  );
}
