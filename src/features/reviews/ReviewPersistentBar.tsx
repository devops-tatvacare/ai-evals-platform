import { useState, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PencilLine, Save, SendHorizontal, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog } from '@/components/ui';
import { useReviewModeStore } from '@/stores/reviewModeStore';

export function ReviewPersistentBar() {
  const active = useReviewModeStore((s) => s.active);
  const status = useReviewModeStore((s) => s.status);
  const edits = useReviewModeStore((s) => s.edits);
  const baselineEdits = useReviewModeStore((s) => s.baselineEdits);
  const saveDraft = useReviewModeStore((s) => s.saveDraft);
  const finalize = useReviewModeStore((s) => s.finalize);
  const discardDraft = useReviewModeStore((s) => s.discardDraft);

  const [discardOpen, setDiscardOpen] = useState(false);

  const { dirtyCount, dirtySummary, isDirty } = useMemo(
    () => useReviewModeStore.getState().getDirty(),
    [edits, baselineEdits],
  );
  const saving = status === 'saving' || status === 'finalizing';

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="review-persistent-bar"
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed bottom-0 left-0 right-0 border-t border-[var(--interactive-primary)]/25 bg-[color-mix(in_srgb,var(--interactive-primary)_9%,var(--bg-primary))] px-6 py-3 shadow-[0_-10px_24px_color-mix(in_srgb,var(--interactive-primary)_10%,transparent)] backdrop-blur-sm"
          style={{ zIndex: 'var(--z-sticky)' }}
        >
          <div className="mx-auto flex max-w-screen-xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              {isDirty ? (
                <>
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-brand)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-brand)] animate-pulse" />
                    {dirtyCount} unsaved {dirtyCount === 1 ? 'change' : 'changes'}
                  </div>
                  {dirtySummary && (
                    <p className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">
                      {dirtySummary}
                    </p>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-secondary)]">
                  <PencilLine className="h-3.5 w-3.5" />
                  Review in progress
                </div>
              )}
            </div>
            <div className="flex gap-1.5 self-end md:self-auto">
              <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setDiscardOpen(true)} disabled={saving}>
                Discard
              </Button>
              {isDirty && (
                <Button variant="secondary" size="sm" icon={Save} onClick={saveDraft} isLoading={saving}>
                  Save Draft
                </Button>
              )}
              <Button size="sm" icon={SendHorizontal} onClick={finalize} isLoading={saving}>
                Finalize
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      <ConfirmDialog
        isOpen={discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          discardDraft();
        }}
        title="Discard review draft"
        description={isDirty
          ? 'Discard the current review draft and all unsaved changes? This cannot be undone.'
          : 'Discard the review draft? This cannot be undone.'}
        confirmLabel="Discard"
        variant="danger"
      />
    </AnimatePresence>
  );
}
