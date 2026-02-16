import { type ReactNode, useEffect, useCallback, useState } from 'react';
import { X, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { cn } from '@/utils';
import { Button } from '@/components/ui';

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
  const [isVisible, setIsVisible] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;

  // Trigger slide-in animation after mount
  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showCloseConfirm) {
          setShowCloseConfirm(false);
        } else {
          handleClose();
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [handleClose, showCloseConfirm]);

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm transition-opacity duration-300',
          isVisible ? 'opacity-100' : 'opacity-0'
        )}
      />

      {/* Slide-in panel from right */}
      <div
        className={cn(
          'ml-auto relative z-10 h-full w-[900px] max-w-full bg-[var(--bg-elevated)] shadow-2xl overflow-hidden',
          'flex flex-col',
          'transform transition-transform duration-300 ease-out',
          isVisible ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
          <button
            onClick={handleClose}
            className="rounded-[6px] p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step navigation bar */}
        <div className="shrink-0 border-b border-[var(--border-subtle)] px-6 py-3">
          <div className="flex items-center gap-2">
            {steps.map((step, i) => (
              <div key={step.key} className="flex items-center">
                {i > 0 && (
                  <div
                    className={cn(
                      'w-8 h-px mr-2',
                      i <= currentStep
                        ? 'bg-[var(--interactive-primary)]'
                        : 'bg-[var(--border-default)]'
                    )}
                  />
                )}
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold transition-colors',
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
                      'text-[12px] font-medium whitespace-nowrap',
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
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-[var(--border-subtle)]">
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
      </div>

      {/* Close confirmation dialog */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-[var(--bg-overlay)]"
            onClick={() => setShowCloseConfirm(false)}
          />
          <div className="relative z-10 bg-[var(--bg-elevated)] rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
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
          </div>
        </div>
      )}
    </div>
  );
}
