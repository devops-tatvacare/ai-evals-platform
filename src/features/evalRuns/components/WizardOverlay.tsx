import { type ReactNode, useEffect, useCallback, useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { cn } from '@/utils';
import { Button } from '@/components/ui';
import { useRightOverlay } from '@/hooks';

export interface WizardStep {
  key: string;
  label: string;
}

interface WizardOverlayProps {
  title: string;
  steps: WizardStep[];
  currentStep: number;
  onClose: () => void;
  onBack: () => void;
  onNext: () => void;
  canGoNext: boolean;
  onSubmit: () => void;
  isSubmitting: boolean;
  submitLabel?: string;
  isDirty?: boolean;
  children: ReactNode;
}

export function WizardOverlay({
  title,
  steps,
  currentStep,
  onClose,
  onBack,
  onNext,
  canGoNext,
  onSubmit,
  isSubmitting,
  submitLabel = 'Submit',
  isDirty = false,
  children,
}: WizardOverlayProps) {
  const titleId = useId();
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;

  const handleClose = useCallback(() => {
    if (isDirty) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  const handleConfirmClose = useCallback(() => {
    setShowCloseConfirm(false);
    onClose();
  }, [onClose]);

  // Escape dismisses the confirm dialog first if it's open, otherwise attempts
  // to close the wizard (which re-opens the confirm when there are unsaved
  // changes). Routed through useRightOverlay so only the topmost surface fires.
  const handleEscape = useCallback(() => {
    if (showCloseConfirm) {
      setShowCloseConfirm(false);
    } else {
      handleClose();
    }
  }, [showCloseConfirm, handleClose]);

  const ariaProps = useRightOverlay(true, { onClose: handleEscape, labelledBy: titleId });

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'unset'; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      />

      {/* Slide-in panel from right */}
        <motion.div
          {...ariaProps}
          className={cn(
            'ml-auto relative z-10 h-full w-[860px] max-w-full overflow-hidden bg-[var(--bg-elevated)] shadow-2xl',
            'flex flex-col',
          )}
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
        >
          {/* Header */}
          <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5 py-3">
            <div className="flex items-center justify-between gap-4">
              <h2 id={titleId} className="text-[20px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
                {title}
              </h2>
              <button
                onClick={handleClose}
                className="rounded-[8px] p-1.5 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

        {/* Step navigation bar */}
        <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/20 px-5 py-2">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {steps.map((step, i) => (
              <div key={step.key} className="flex items-center shrink-0">
                {i > 0 && (
                  <div
                    className={cn(
                      'mr-2 h-px w-8',
                      i <= currentStep
                        ? 'bg-[var(--interactive-primary)]'
                        : 'bg-[var(--border-default)]'
                    )}
                  />
                )}
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                      i === currentStep
                        ? 'bg-[var(--interactive-primary)] text-[var(--text-on-color)]'
                        : i < currentStep
                          ? 'bg-[var(--surface-info)] text-[var(--color-info)]'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                    )}
                  >
                    {i < currentStep ? <Check className="h-3 w-3" /> : i + 1}
                  </div>
                  <span
                    className={cn(
                      'whitespace-nowrap text-[12px] font-medium',
                      i === currentStep
                        ? 'text-[var(--text-primary)]'
                        : i < currentStep
                          ? 'text-[var(--color-info)]'
                          : 'text-[var(--text-muted)]'
                    )}
                  >
                    {step.label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,var(--bg-elevated)_0%,var(--bg-secondary)_100%)] px-5 py-2.5">
          <div>
            {children}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/95 px-5 py-2 backdrop-blur">
          <div className="text-[12px] text-[var(--text-muted)]">
            Step {currentStep + 1} of {steps.length}
          </div>
          <div className="flex gap-2">
            {!isFirstStep && (
              <Button
                variant="secondary"
                size="md"
                onClick={onBack}
                disabled={isSubmitting}
                icon={ArrowLeft}
              >
                Back
              </Button>
            )}
            {isLastStep ? (
              <Button
                variant="primary"
                size="md"
                onClick={onSubmit}
                disabled={!canGoNext || isSubmitting}
                isLoading={isSubmitting}
              >
                {isSubmitting ? 'Submitting...' : submitLabel}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="md"
                onClick={onNext}
                disabled={!canGoNext}
                icon={ArrowRight}
              >
                Next
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Close confirmation dialog */}
      <AnimatePresence>
        {showCloseConfirm && (
          <div className="fixed inset-0 z-[var(--z-dropdown)] flex items-center justify-center">
            <motion.div
              className="absolute inset-0 bg-[var(--bg-overlay)]"
              onClick={() => setShowCloseConfirm(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            />
            <motion.div
              className="relative z-10 bg-[var(--bg-elevated)] rounded-lg shadow-lg p-6 max-w-sm w-full mx-4"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 4 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-2">
                Discard changes?
              </h3>
              <p className="text-[13px] text-[var(--text-secondary)] mb-4">
                You have unsaved progress. Are you sure you want to close?
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" size="sm" onClick={() => setShowCloseConfirm(false)}>
                  Keep editing
                </Button>
                <Button variant="danger" size="sm" onClick={handleConfirmClose}>
                  Discard
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
