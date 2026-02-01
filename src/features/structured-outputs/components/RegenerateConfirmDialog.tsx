import { Modal, Button } from '@/components/ui';
import { AlertTriangle } from 'lucide-react';

interface RegenerateConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function RegenerateConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  isLoading = false,
}: RegenerateConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Regenerate Output?" className="max-w-md">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-[var(--color-warning-light)] p-2">
            <AlertTriangle className="h-5 w-5 text-[var(--color-warning)]" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-[var(--text-secondary)]">
              This will make a new LLM call with the same prompt and settings. The current result will be replaced.
            </p>
            <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">
              Are you sure you want to continue?
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isLoading} isLoading={isLoading}>
            Regenerate
          </Button>
        </div>
      </div>
    </Modal>
  );
}
