import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ui';
import { useReviewModeStore } from '@/stores/reviewModeStore';
import { stripReviewItemPrefix } from './keys';

/** Allow movement only between run-detail and thread/call-detail within the
 * active review scope. Every other path is blocked.
 */
function isAllowedPath(pathname: string, runId: string | null, itemIds: Set<string>): boolean {
  if (runId && pathname.includes(`/runs/${runId}`)) return true;
  const itemMatch = pathname.match(/\/(?:threads|calls)\/([^/]+)/);
  if (itemMatch && itemIds.has(itemMatch[1])) return true;
  return false;
}

export function ReviewNavigationBlocker() {
  const navigate = useNavigate();
  const location = useLocation();
  const active = useReviewModeStore((s) => s.active);
  const runId = useReviewModeStore((s) => s.runId);
  const context = useReviewModeStore((s) => s.context);
  const saveDraft = useReviewModeStore((s) => s.saveDraft);
  const discardDraft = useReviewModeStore((s) => s.discardDraft);

  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const prevLocationRef = useRef(location);
  const bouncingRef = useRef(false);

  const itemIds = useMemo(
    () => new Set((context?.items ?? []).map((item) => stripReviewItemPrefix(item.itemKey))),
    [context],
  );

  // Pre-empt clean cases: <a href> link clicks (sidebar NavLinks, in-page
  // <Link>s). Catching them here prevents react-router from navigating in
  // the first place — no URL flash.
  useEffect(() => {
    if (!active) return;

    const handler = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;

      if (url.pathname === window.location.pathname) return;
      if (isAllowedPath(url.pathname, runId, itemIds)) return;

      event.preventDefault();
      event.stopPropagation();
      setPendingHref(`${url.pathname}${url.search}${url.hash}`);
    };

    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [active, runId, itemIds]);

  // Catch-all chokepoint. Anything that slips past the anchor handler —
  // `useNavigate()` calls (PageSurface header back button, AppSwitcher,
  // post-action handlers), browser back/forward, manual URL edits — lands
  // here. We bounce the location back to the previous one and open the
  // dialog with the intended destination.
  useEffect(() => {
    if (!active) {
      prevLocationRef.current = location;
      return;
    }
    if (bouncingRef.current) {
      bouncingRef.current = false;
      prevLocationRef.current = location;
      return;
    }
    const prev = prevLocationRef.current;
    if (location.pathname === prev.pathname && location.search === prev.search) {
      prevLocationRef.current = location;
      return;
    }
    if (isAllowedPath(location.pathname, runId, itemIds)) {
      prevLocationRef.current = location;
      return;
    }
    // Subscribing to an external location source and dispatching a redirect
    // is exactly the case the lint rule's "you might not need an effect"
    // guidance explicitly carves out — react-router's location is the
    // external state we react to.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingHref(`${location.pathname}${location.search}${location.hash}`);
    bouncingRef.current = true;
    navigate(`${prev.pathname}${prev.search}${prev.hash}`, { replace: true });
  }, [location, active, runId, itemIds, navigate]);

  // Tab close / refresh.
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);

  const handleClose = useCallback(() => setPendingHref(null), []);

  const handleDiscard = useCallback(async () => {
    const href = pendingHref;
    setPendingHref(null);
    await discardDraft();
    if (href) {
      // discardDraft schedules `exitReview` at +500ms; wait past that
      // before navigating so the watcher sees active=false and lets the
      // navigation through.
      setTimeout(() => navigate(href), 600);
    }
  }, [pendingHref, discardDraft, navigate]);

  const handleSaveAndLeave = useCallback(async () => {
    const href = pendingHref;
    setPendingHref(null);
    await saveDraft();
    useReviewModeStore.getState().exitReview();
    if (href) {
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
