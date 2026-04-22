import { FileText } from 'lucide-react';
import { routes } from '@/config/routes';
import { EvalRunDetail } from '@/features/evalRuns';

export function KairaRunDetailPage() {
  return (
    <EvalRunDetail
      surface={{
        icon: FileText,
        back: { to: routes.kaira.runs, label: 'Runs' },
      }}
    />
  );
}
