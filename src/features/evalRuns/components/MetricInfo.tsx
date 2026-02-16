import { useRef, useState } from "react";
import { Info } from "lucide-react";
import { getMetricDefinition } from "@/config/labelDefinitions";
import Tooltip from "./Tooltip";

interface Props {
  metricKey: string;
  className?: string;
}

export default function MetricInfo({ metricKey, className = "" }: Props) {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const def = getMetricDefinition(metricKey);

  return (
    <span ref={ref} className={`inline-flex ${className}`}>
      <Info
        className="h-3.5 w-3.5 inline-block text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-help transition-colors"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      <Tooltip
        title={def.displayName}
        body={def.tooltip}
        visible={hover}
        anchorRef={ref}
      />
    </span>
  );
}
