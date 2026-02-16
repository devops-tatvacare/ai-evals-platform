import VerdictBadge from "./VerdictBadge";
import type { LabelCategory } from "@/config/labelDefinitions";

interface Props {
  label: string;
  category: LabelCategory;
  size?: "sm" | "md";
  showTooltip?: boolean;
}

export default function LabelBadge({ label, category, size = "sm", showTooltip = true }: Props) {
  return (
    <VerdictBadge verdict={label} category={category} size={size} showTooltip={showTooltip} />
  );
}
