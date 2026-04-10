import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ui';
import { useReviewModeStore } from '@/stores/reviewModeStore';

function isAllowedPath(pathname: string, runId: string | null, threadIds: Set<string>): boolean {
  if (runId && pathname.includes(`/runs/${runId}`)) return true;
  const threadMatch = pathname.match(/\/threads\/([^/]+)/);
  if (threadMatch && threadIds.has(threadMatch[1])) return true;
  return false;
}

export function ReviewNavigationBlocker() {
  const navigate = useNavigate();
  const active = useReviewModeStore((s) => s.active);
  const runId = useReviewModeStore((s) => s.runId);
  const context = useReviewModeStore((s) => s.context);
  const saveDraft = useReviewModeStore((s) => s.saveDraft);
  const discardDraft = useReviewModeStore((s) => s.discardDraft);

  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // Build set of thread IDs belonging to the active run
  const threadIds = useMemo(() => {
    if (!context?.items) return new Set<string>();
    return new Set(context.items.map((item) => {
      const raw = item.itemKey.includes(':') ? item.itemKey.split(':').slice(1).join(':') : item.itemKey;
      return raw;
    }));
  }, [context?.items]);

  // Intercept all internal link clicks
  useEffect(() => {
    if (!active) return;

    const handler = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;

      const nextPath = url.pathname;
      const currentPath = window.location.pathname;
      if (nextPath === currentPath) return;

      if (isAllowedPath(nextPath, runId, threadIds)) return;

      // Block this navigation
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(`${url.pathname}${url.search}${url.hash}`);
    };

    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [active, runId, threadIds]);

  // Block browser close / refresh
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);

  // Block browser back/forward
  useEffect(() => {
    if (!active) return;
    const handler = () => {
      // Push current state back to prevent leaving
      window.history.pushState(null, '', window.location.href);
      setPendingHref('__back__');
    };
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [active]);

  const handleClose = useCallback(() => setPendingHref(null), []);

  const handleDiscard = useCallback(async () => {
    const href = pendingHref;
    setPendingHref(null);
    await discardDraft();
    if (href && href !== '__back__') {
      // Wait for exitReview to complete
      setTimeout(() => navigate(href), 600);
    }
  }, [pendingHref, discardDraft, navigate]);

  const handleSaveAndLeave = useCallback(async () => {
    const href = pendingHref;
    setPendingHref(null);
    await saveDraft();
    useReviewModeStore.getState().exitReview();
    if (href && href !== '__back__') {
      setTimeout(() => navigate(href), 100);
    }
  }, [pendingHref, saveDraft, navigate]);

  return (
    <ConfirmDialog
      isOpen={pendingHref != null}
      onClose={handleClose}
      onConfirm={handleDiscard}
      title="Leave review mode?"
      description="You have an active review session. Save your draft before leaving, or discard all changes."
      confirmLabel="Discard & Leave"
      variant="danger"
      extraActions={[
        {
          label: 'Save Draft & Leave',
          onClick: handleSaveAndLeave,
          variant: 'secondary',
        },
      ]}
    />
  );
}
