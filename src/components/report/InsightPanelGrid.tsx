import InsightPanel, { type InsightPanelData } from './InsightPanel';

interface Props {
  panels: InsightPanelData[];
  /** Override the collapsed-by-default item count for every panel. */
  maxCollapsed?: number;
}

export default function InsightPanelGrid({ panels, maxCollapsed }: Props) {
  if (panels.length === 0) return null;
  return (
    <div className="space-y-2">
      {panels.map((panel, i) => (
        <InsightPanel key={`${panel.area}-${i}`} {...panel} maxCollapsed={maxCollapsed} />
      ))}
    </div>
  );
}
