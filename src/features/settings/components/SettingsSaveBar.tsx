import { useState } from 'react';
import { Save, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export function SettingsSaveBar({
  isDirty,
  isSaving,
  onSave,
  onDiscard,
}: {
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void | Promise<void>;
  onDiscard: () => void;
}) {
  const [confirm, setConfirm] = useState<'save' | 'discard' | null>(null);

  if (!isDirty && !isSaving) return null;

  return (
    <>
      <div className="fixed bottom-6 right-6 z-[var(--z-overlay)] flex gap-3">
        <Button
          variant="secondary"
          onClick={() => setConfirm('discard')}
          disabled={isSaving}
          className="shadow-lg gap-2"
        >
          <X className="h-4 w-4" />
          Discard
        </Button>
        <Button
          onClick={() => setConfirm('save')}
          isLoading={isSaving}
          className="shadow-lg gap-2"
        >
          <Save className="h-4 w-4" />
          Save Changes
        </Button>
      </div>

      <ConfirmDialog
        isOpen={confirm === 'save'}
        title="Save changes?"
        description="Apply these settings changes now?"
        confirmLabel="Save changes"
        cancelLabel="Cancel"
        variant="primary"
        isLoading={isSaving}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await onSave();
          setConfirm(null);
        }}
      />

      <ConfirmDialog
        isOpen={confirm === 'discard'}
        title="Discard changes?"
        description="Your unsaved changes will be lost. This can’t be undone."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="danger"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          onDiscard();
          setConfirm(null);
        }}
      />
    </>
  );
}
