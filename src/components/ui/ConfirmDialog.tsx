import { Trash2, AlertTriangle, type LucideIcon } from 'lucide-react';
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
  /** Override the default icon. Set to `null` to hide. */
  icon?: LucideIcon | null;
}

const variantDefaults: Record<string, { icon: LucideIcon; buttonVariant: ButtonVariant; accent: string }> = {
  danger: {
    icon: Trash2,
    buttonVariant: 'danger',
    accent: 'var(--color-error)',
  },
  warning: {
    icon: AlertTriangle,
    buttonVariant: 'secondary',
    accent: 'var(--color-warning)',
  },
  primary: {
    icon: AlertTriangle,
    buttonVariant: 'primary',
    accent: 'var(--interactive-primary)',
  },
};

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
  icon,
}: ConfirmDialogProps) {
  const defaults = variantDefaults[variant] ?? variantDefaults.primary;
  const Icon = icon === null ? null : (icon ?? defaults.icon);

  return (
    <Modal isOpen={isOpen} onClose={isLoading ? () => {} : onClose} title={title}>
      <div className="space-y-4">
        <div className="flex gap-3 items-start">
          {Icon && (
            <div
              className="shrink-0 flex items-center justify-center h-9 w-9 rounded-lg"
              style={{ backgroundColor: `color-mix(in srgb, ${defaults.accent} 12%, transparent)` }}
            >
              <Icon className="h-4.5 w-4.5" style={{ color: defaults.accent }} />
            </div>
          )}
          <p className="text-[13px] text-[var(--text-secondary)] pt-1.5 leading-relaxed">
            {description}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            variant={defaults.buttonVariant}
            onClick={onConfirm}
            isLoading={isLoading}
            icon={Icon ?? undefined}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
