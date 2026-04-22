import { Gauge } from 'lucide-react';
import { AppEvaluatorsPage } from '@/features/evals';

export function KairaEvaluatorsPage() {
  return <AppEvaluatorsPage surface={{ icon: Gauge, title: 'Evaluators' }} />;
}
