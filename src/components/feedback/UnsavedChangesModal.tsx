import { Modal, Button } from '@/components/ui';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  onDiscard: () => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving?: boolean;
}

export function UnsavedChangesModal({
  isOpen,
  onDiscard,
  onSave,
  onCancel,
  isSaving,
}: UnsavedChangesModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Unsaved Changes">
      <div className="space-y-4">
        <p className="text-[14px] text-[var(--text-secondary)]">
          You have unsaved changes. Would you like to save them before leaving?
        </p>
        
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onDiscard}>
            Discard
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSave} isLoading={isSaving}>
            Save Changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}
