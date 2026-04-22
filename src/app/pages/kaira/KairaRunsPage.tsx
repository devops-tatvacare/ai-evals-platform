import { ListChecks } from 'lucide-react';
import { EvalRunList } from '@/features/evalRuns';

export function KairaRunsPage() {
  return <EvalRunList surface={{ icon: ListChecks, title: 'All Runs' }} />;
}
