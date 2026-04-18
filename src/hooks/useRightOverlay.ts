import { useEffect, useMemo, useRef } from 'react';
import { useUIStore } from '@/stores';

/**
 * Options for {@link useRightOverlay}.
 *
 * `onClose` — if provided, the hook installs a document-level Escape handler
 * that calls `onClose`. A module-level stack guarantees only the topmost
 * overlay responds to Escape so nested overlays unwind one layer at a time.
 *
 * `labelledBy` — DOM id of the element labelling the overlay (e.g. its
 * header heading). Copied verbatim into the returned `aria-labelledby`.
 */
export interface UseRightOverlayOptions {
  onClose?: () => void;
  labelledBy?: string;
}

/**
 * ARIA + a11y props returned by {@link useRightOverlay}. Spread onto the
 * overlay's root element so every right-edge surface in the app exposes a
 * consistent dialog contract to assistive tech.
 */
export interface RightOverlayProps {
  role: 'dialog';
  'aria-modal': 'false';
  'aria-labelledby'?: string;
  tabIndex: -1;
}

type EscapeEntry = { handler: () => void };

const escapeStack: EscapeEntry[] = [];
let escapeListenerAttached = false;

function ensureEscapeListener(): void {
  if (escapeListenerAttached || typeof document === 'undefined') return;
  escapeListenerAttached = true;
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const top = escapeStack[escapeStack.length - 1];
    if (!top) return;
    event.stopPropagation();
    top.handler();
  });
}

/**
 * Registers a right-edge overlay with the UI store so the Sherlock chat FAB
 * (and any other right-anchored surface) can hide while an overlay is open.
 *
 * When called with an options object:
 *  - Escape-to-close is wired at the document level via a single stack so
 *    only the topmost overlay responds.
 *  - Focus is captured on open and restored on close, so keyboard users
 *    return to the element that opened the overlay.
 *  - ARIA props (`role="dialog"`, `aria-modal="false"`, `tabIndex=-1`,
 *    optional `aria-labelledby`) are returned for the caller to spread on
 *    the overlay's root element.
 *
 * Overloads let legacy callers keep the simple `useRightOverlay(open)` form
 * while newer callers opt into the full contract.
 */
export function useRightOverlay(open: boolean): RightOverlayProps;
export function useRightOverlay(open: boolean, options: UseRightOverlayOptions): RightOverlayProps;
export function useRightOverlay(open: boolean, options?: UseRightOverlayOptions): RightOverlayProps {
  const onClose = options?.onClose;
  const labelledBy = options?.labelledBy;

  // Keep a stable ref to onClose so the stack entry identity never changes.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Register with the right-overlay counter so the chat FAB hides.
  useEffect(() => {
    if (!open) return;
    useUIStore.getState().pushRightOverlay();
    return () => useUIStore.getState().popRightOverlay();
  }, [open]);

  // Escape-to-close via a single document listener + stack of handlers.
  useEffect(() => {
    if (!open || !onClose) return;
    ensureEscapeListener();
    const entry: EscapeEntry = { handler: () => onCloseRef.current?.() };
    escapeStack.push(entry);
    return () => {
      const idx = escapeStack.lastIndexOf(entry);
      if (idx !== -1) escapeStack.splice(idx, 1);
    };
  }, [open, onClose]);

  // Focus restoration: capture the element that was focused before the
  // overlay opened, and return focus to it on close so keyboard users
  // don't get stranded at document body.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null;
    return () => {
      const prev = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (prev && document.contains(prev) && typeof prev.focus === 'function') {
        prev.focus();
      }
    };
  }, [open]);

  return useMemo<RightOverlayProps>(() => ({
    role: 'dialog',
    'aria-modal': 'false',
    'aria-labelledby': labelledBy,
    tabIndex: -1,
  }), [labelledBy]);
}
