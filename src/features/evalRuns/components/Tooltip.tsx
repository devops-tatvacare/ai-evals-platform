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
const ARROW_COLOR = "#0f172a";
const MIN_SPACE = 80;

export default function Tooltip({ title, body, visible, anchorRef }: Props) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ top: number; left: number; placement: Placement } | null>(null);

  useLayoutEffect(() => {
    if (!visible || !anchorRef.current) {
      setLayout(null);
      return;
    }

    const anchor = anchorRef.current.getBoundingClientRect();
    let left = anchor.left + anchor.width / 2 - TIP_WIDTH / 2;
    left = Math.max(GAP, Math.min(left, window.innerWidth - TIP_WIDTH - GAP));

    const spaceAbove = anchor.top;
    const placement: Placement = spaceAbove < MIN_SPACE ? "below" : "above";
    const top = placement === "above"
      ? anchor.top - GAP
      : anchor.bottom + GAP;

    setLayout({ top, left, placement });
  }, [visible, anchorRef]);

  if (!visible || !layout) return null;

  const isAbove = layout.placement === "above";

  return createPortal(
    <div
      ref={tipRef}
      className="fixed z-[9999] w-64 pointer-events-none"
      style={{
        top: layout.top,
        left: layout.left,
        transform: isAbove ? "translateY(-100%)" : undefined,
      }}
    >
      {!isAbove && (
        <div className="mx-auto" style={arrowStyle("up")} />
      )}
      <div className="bg-slate-900 text-white text-[0.72rem] rounded-md p-2.5 shadow-lg">
        <div className="font-semibold mb-0.5">{title}</div>
        <div className="text-slate-300 leading-relaxed">{body}</div>
      </div>
      {isAbove && (
        <div className="mx-auto" style={arrowStyle("down")} />
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
