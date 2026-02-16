import { Modal, Button } from '@/components/ui';
import type { ButtonVariant } from '@/components/ui/Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'warning' | 'danger' | 'primary';
  isLoading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  isLoading = false,
}: ConfirmDialogProps) {
  const buttonVariant: Record<string, ButtonVariant> = {
    warning: 'secondary',
    danger: 'danger',
    primary: 'primary',
  };

  return (
    <Modal isOpen={isOpen} onClose={isLoading ? () => {} : onClose} title={title}>
      <div className="space-y-4">
        <p className="text-[13px] text-[var(--text-secondary)]">
          {description}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            variant={buttonVariant[variant]}
            onClick={onConfirm}
            isLoading={isLoading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
