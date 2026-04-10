import { useState } from 'react';
import { Button } from '@/components/ui';

interface Props {
  initialNote: string;
  onSave: (note: string) => void;
  onClose: () => void;
}

export function NoteModal({ initialNote, onSave, onClose }: Props) {
  const [value, setValue] = useState(initialNote);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg shadow-xl w-full max-w-md p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Review Note</h3>
        <textarea
          className="w-full h-24 text-sm rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-primary)] p-2 resize-y focus:outline-none focus:border-[var(--border-brand)]"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add a note for this review item..."
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => onSave(value)}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
