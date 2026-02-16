import { useRef, useState } from "react";
import { Info } from "lucide-react";
import { getMetricDefinition } from "@/config/labelDefinitions";
import Tooltip from "./Tooltip";

interface Props {
  metricKey: string;
  size?: number;
  className?: string;
}

export default function MetricInfo({ metricKey, size = 14, className = "" }: Props) {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const def = getMetricDefinition(metricKey);

  return (
    <span ref={ref} className={`inline-flex ${className}`}>
      <Info
        size={size}
        className="inline-block text-slate-400 hover:text-slate-600 cursor-help transition-colors"
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
