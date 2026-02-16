import { useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  title: string;
  body: string;
  visible: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
}

type Placement = "above" | "below";

const TIP_WIDTH = 256;
const GAP = 8;
const ARROW_SIZE = 6;
const ARROW_COLOR = "var(--bg-elevated)";

interface Layout {
  top: number;
  left: number;
  placement: Placement;
  arrowLeft: number;
}

export default function Tooltip({ title, body, visible, anchorRef }: Props) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);

  useLayoutEffect(() => {
    if (!visible || !anchorRef.current) {
      setLayout(null);
      return;
    }

    const anchor = anchorRef.current.getBoundingClientRect();
    // Use clientWidth to exclude scrollbar width
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // Centre tooltip on anchor, then clamp to viewport
    const anchorCenterX = anchor.left + anchor.width / 2;
    let left = anchorCenterX - TIP_WIDTH / 2;
    left = Math.max(GAP, Math.min(left, vw - TIP_WIDTH - GAP));

    // Arrow should always point at the anchor center
    const arrowLeft = Math.max(
      ARROW_SIZE + GAP,
      Math.min(anchorCenterX - left, TIP_WIDTH - ARROW_SIZE - GAP),
    );

    // Measure tooltip height for placement decision (estimate if not rendered yet)
    const tipEl = tipRef.current;
    const tipHeight = tipEl ? tipEl.offsetHeight : 120;

    const spaceAbove = anchor.top;
    const spaceBelow = vh - anchor.bottom;

    let placement: Placement;
    if (spaceAbove >= tipHeight + GAP + ARROW_SIZE) {
      placement = "above";
    } else if (spaceBelow >= tipHeight + GAP + ARROW_SIZE) {
      placement = "below";
    } else {
      // Pick whichever side has more room
      placement = spaceAbove >= spaceBelow ? "above" : "below";
    }

    const top = placement === "above"
      ? anchor.top - GAP
      : anchor.bottom + GAP;

    setLayout({ top, left, placement, arrowLeft });
  }, [visible, anchorRef]);

  if (!visible || !layout) return null;

  const isAbove = layout.placement === "above";

  return createPortal(
    <div
      ref={tipRef}
      className="fixed z-[9999] pointer-events-none"
      style={{
        top: layout.top,
        left: layout.left,
        width: TIP_WIDTH,
        maxWidth: `calc(100vw - ${GAP * 2}px)`,
        transform: isAbove ? "translateY(-100%)" : undefined,
      }}
    >
      {!isAbove && (
        <div style={{ ...arrowStyle("up"), marginLeft: layout.arrowLeft - ARROW_SIZE }} />
      )}
      <div className="bg-[var(--bg-elevated)] text-[var(--text-primary)] text-[var(--text-xs)] rounded-md p-2.5 border border-[var(--border-default)] shadow-lg max-h-[40vh] overflow-y-auto">
        <div className="font-semibold mb-0.5">{title}</div>
        <div className="text-[var(--text-secondary)] leading-relaxed">{body}</div>
      </div>
      {isAbove && (
        <div style={{ ...arrowStyle("down"), marginLeft: layout.arrowLeft - ARROW_SIZE }} />
      )}
    </div>,
    document.body,
  );
}

function arrowStyle(direction: "up" | "down"): React.CSSProperties {
  return {
    width: 0,
    height: 0,
    borderLeft: `${ARROW_SIZE}px solid transparent`,
    borderRight: `${ARROW_SIZE}px solid transparent`,
    ...(direction === "down"
      ? { borderTop: `${ARROW_SIZE}px solid ${ARROW_COLOR}` }
      : { borderBottom: `${ARROW_SIZE}px solid ${ARROW_COLOR}` }),
  };
}
