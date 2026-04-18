import { type ReactNode, useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { Button, ConfirmDialog } from '@/components/ui';
import { useRightOverlay } from '@/hooks';
import { cn } from '@/utils';

interface SettingsSlideOverProps {
  isOpen: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  canSubmit?: boolean;
  isSubmitting?: boolean;
  isDirty?: boolean;
  widthClassName?: string;
  children: ReactNode;
  footerContent?: ReactNode;
}

export function SettingsSlideOver({
  isOpen,
  title,
  description,
  onClose,
  onSubmit,
  submitLabel = 'Save',
  canSubmit = true,
  isSubmitting = false,
  isDirty = false,
  widthClassName = 'w-[60vw] max-w-[900px]',
  children,
  footerContent,
}: SettingsSlideOverProps) {
  const titleId = useId();
  const [isVisible, setIsVisible] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => setIsVisible(true));
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
      setIsVisible(false);
      setShowCloseConfirm(false);
    };
  }, [isOpen]);

  const handleClose = useCallback(() => {
    if (isDirty && !isSubmitting) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  }, [isDirty, isSubmitting, onClose]);

  // Escape dismisses the confirm dialog first, then attempts to close the
  // slide-over (which re-opens the confirm when there are unsaved changes).
  // Routed through useRightOverlay so only the topmost surface fires.
  const handleEscape = useCallback(() => {
    if (showCloseConfirm) {
      setShowCloseConfirm(false);
      return;
    }
    handleClose();
  }, [showCloseConfirm, handleClose]);

  const ariaProps = useRightOverlay(isOpen, { onClose: handleEscape, labelledBy: titleId });

  if (!isOpen) return null;

  return createPortal(
    <>
      <div
        className={cn(
          'fixed inset-0 z-[var(--z-overlay)] bg-[var(--bg-overlay)] backdrop-blur-[2px] transition-opacity duration-300',
          isVisible ? 'opacity-100' : 'opacity-0',
        )}
        onClick={handleClose}
      />

      <div
        {...ariaProps}
        className={cn(
          'fixed inset-y-0 right-0 z-[calc(var(--z-overlay)+1)] bg-[var(--bg-primary)] shadow-2xl flex flex-col',
          'transform transition-transform duration-300 ease-out',
          widthClassName,
          isVisible ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="shrink-0 flex items-start justify-between gap-4 px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
          <div>
            <h2 id={titleId} className="text-[16px] font-semibold text-[var(--text-primary)]">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                {description}
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>

        <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]">
          <div className="min-w-0">
            {footerContent}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            {onSubmit && (
              <Button
                onClick={onSubmit}
                disabled={!canSubmit || isSubmitting}
                isLoading={isSubmitting}
              >
                {submitLabel}
              </Button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showCloseConfirm}
        onClose={() => setShowCloseConfirm(false)}
        onConfirm={onClose}
        title="Discard changes?"
        description="You have unsaved changes in this editor. Close it anyway?"
        confirmLabel="Discard"
        variant="danger"
      />
    </>,
    document.body,
  );
}
