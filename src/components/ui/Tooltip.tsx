import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  maxWidth?: number;
  /** Delay in ms before closing on mouse leave. Allows cursor to travel into the tooltip. */
  closeDelay?: number;
}

export function Tooltip({ content, children, position = 'top', maxWidth = 300, closeDelay = 0 }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setIsVisible(false);
      closeTimerRef.current = null;
    }, closeDelay);
  }, [cancelClose, closeDelay]);

  const openNow = useCallback(() => {
    cancelClose();
    setIsVisible(true);
  }, [cancelClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  useEffect(() => {
    if (isVisible && triggerRef.current && tooltipRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();

      let x = 0;
      let y = 0;

      switch (position) {
        case 'top':
          x = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
          y = triggerRect.top - tooltipRect.height - 8;
          break;
        case 'bottom':
          x = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
          y = triggerRect.bottom + 8;
          break;
        case 'left':
          x = triggerRect.left - tooltipRect.width - 8;
          y = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
          break;
        case 'right':
          x = triggerRect.right + 8;
          y = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
          break;
      }

      // Keep tooltip within viewport
      x = Math.max(8, Math.min(x, window.innerWidth - tooltipRect.width - 8));
      y = Math.max(8, Math.min(y, window.innerHeight - tooltipRect.height - 8));

      setCoords({ x, y });
    }
  }, [isVisible, position]);

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        className="inline-flex"
      >
        {children}
      </div>
      {isVisible && (
        <div
          ref={tooltipRef}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{
            position: 'fixed',
            left: coords.x,
            top: coords.y,
            maxWidth,
            zIndex: 'var(--z-tooltip)',
          }}
          className="px-3 py-2 text-[12px] leading-relaxed text-[var(--text-primary)] bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-md shadow-lg"
        >
          {content}
        </div>
      )}
    </>
  );
}
