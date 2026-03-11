import { useNavigate } from 'react-router-dom';
import type { AdversarialHeatmap } from '@/types/crossRunAnalytics';
import { routes } from '@/config/routes';
import SectionHeader from '../report/shared/SectionHeader';
import Heatmap from './Heatmap';

interface Props {
  heatmap: AdversarialHeatmap;
}

export default function AdversarialHeatmapTab({ heatmap }: Props) {
  const navigate = useNavigate();

  const columnHeaders = heatmap.runs.map((r) => {
    const date = r.createdAt
      ? new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';
    return {
      id: r.runId,
      label: r.runName || r.runId.slice(0, 8),
      sublabel: date,
    };
  });

  const rows = heatmap.rows.map((r) => ({
    id: r.goal,
    label: r.goal,
    cells: r.cells,
    average: r.avgPassRate,
  }));

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Adversarial Goal Resilience"
        description="Pass rate per attack goal across adversarial runs."
      />

      <Heatmap
        columnHeaders={columnHeaders}
        rows={rows}
        rowHeaderLabel="Goal"
        onColumnClick={(id) => navigate(routes.kaira.runDetail(id))}
        emptyMessage="No adversarial runs with reports found."
      />
    </div>
  );
}
