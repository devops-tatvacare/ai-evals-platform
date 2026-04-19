import { useCallback, useMemo, useState } from 'react';
import { UnsavedChangesModal } from '@/components/feedback';
import { useInlineReviewOptional } from './InlineReviewProvider';

type PendingAction = (() => void) | null;

export function useInlineReviewNavigationGuard() {
  const review = useInlineReviewOptional();
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const needsGuard = !!review?.isEditing && !!review?.hasDirtyChanges && !review?.saving;

  const closeModal = useCallback(() => {
    setPendingAction(null);
  }, []);

  const runOrQueue = useCallback((action: () => void) => {
    if (!needsGuard) {
      action();
      return true;
    }

    setPendingAction(() => action);
    return false;
  }, [needsGuard]);

  const modal = useMemo(() => (
    <UnsavedChangesModal
      isOpen={needsGuard && pendingAction != null}
      onDiscard={async () => {
        await review?.discardDraft();
        const action = pendingAction;
        closeModal();
        action?.();
      }}
      onSave={async () => {
        await review?.saveDraft();
        const action = pendingAction;
        closeModal();
        action?.();
      }}
      onCancel={closeModal}
      isSaving={review?.saving}
    />
  ), [closeModal, pendingAction, review]);

  return {
    confirmNavigation: runOrQueue,
    guardModal: modal,
  };
}
