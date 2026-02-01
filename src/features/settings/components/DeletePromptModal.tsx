import { AlertTriangle } from 'lucide-react';
import { Modal, Button } from '@/components/ui';
import type { PromptDefinition } from '@/types';

interface DeletePromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  prompt: PromptDefinition | null;
  dependencies: { count: number; listings: string[] };
  onConfirm: () => void;
  isDeleting: boolean;
}

export function DeletePromptModal({
  isOpen,
  onClose,
  prompt,
  dependencies,
  onConfirm,
  isDeleting,
}: DeletePromptModalProps) {
  if (!prompt) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={isDeleting ? () => {} : onClose}
      title={
        <span className="flex items-center gap-2 text-[var(--color-error)]">
          <AlertTriangle className="h-5 w-5" />
          Delete Prompt
        </span>
      }
      className="max-w-md"
    >
      <div className="space-y-4">
        <p className="text-[14px] text-[var(--text-primary)]">
          Are you sure you want to delete <strong>"{prompt.name}"</strong>?
        </p>

        {dependencies.count > 0 && (
          <div className="rounded-[var(--radius-default)] bg-[var(--color-warning-light)] border border-[var(--color-warning)]/30 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0 mt-0.5" />
              <div className="text-[13px] text-[var(--color-warning)]">
                <p className="font-medium">
                  This prompt is used by {dependencies.count} evaluation{dependencies.count !== 1 ? 's' : ''}
                </p>
                {dependencies.listings.length > 0 && (
                  <ul className="mt-2 space-y-1 text-[12px]">
                    {dependencies.listings.slice(0, 5).map((listing, i) => (
                      <li key={i}>• {listing}</li>
                    ))}
                    {dependencies.listings.length > 5 && (
                      <li>• and {dependencies.listings.length - 5} more...</li>
                    )}
                  </ul>
                )}
                <p className="mt-2 text-[12px]">
                  These evaluations will retain a copy of the prompt.
                </p>
              </div>
            </div>
          </div>
        )}

        <p className="text-[13px] text-[var(--text-secondary)]">
          This action cannot be undone.
        </p>

        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            isLoading={isDeleting}
            className="bg-[var(--color-error)] hover:bg-[var(--color-error)]/90"
          >
            {dependencies.count > 0 ? 'Delete Anyway' : 'Delete'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
