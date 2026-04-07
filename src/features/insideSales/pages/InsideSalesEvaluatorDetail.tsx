import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, GitFork, Pencil, Shield, Star } from 'lucide-react';
import { Button, EmptyState, Tabs } from '@/components/ui';
import { CreateEvaluatorWizard } from '@/features/evals/components/CreateEvaluatorWizard';
import { routes } from '@/config/routes';
import { notificationService } from '@/services/notifications';
import { useEvaluatorsStore } from '@/stores';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/utils';
import { isSystemEvaluator } from '@/features/evals/utils/evaluatorMetadata';
import type { EvaluatorDefinition, EvaluatorOutputField } from '@/types';

function getDimensionCount(schema: EvaluatorOutputField[]): number {
  return schema.filter((field) => field.type === 'number' && !field.isMainMetric).length;
}

function getTotalPoints(schema: EvaluatorOutputField[]): number {
  return schema
    .filter((field) => field.type === 'number' && !field.isMainMetric)
    .reduce((sum, field) => {
      const match = field.description?.match(/max (\d+)/);
      return sum + (match ? parseInt(match[1], 10) : 0);
    }, 0);
}

function getComplianceCount(schema: EvaluatorOutputField[]): number {
  return schema.filter((field) => field.type === 'boolean').length;
}

function getPassThreshold(schema: EvaluatorOutputField[]): number | null {
  const mainMetric = schema.find((field) => field.isMainMetric && field.thresholds);
  return mainMetric?.thresholds?.yellow ?? null;
}

function getExcellentThreshold(schema: EvaluatorOutputField[]): number | null {
  const mainMetric = schema.find((field) => field.isMainMetric && field.thresholds);
  return mainMetric?.thresholds?.green ?? null;
}

function TypeBadge({ evaluator }: { evaluator: EvaluatorDefinition }) {
  if (evaluator.forkedFrom) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
        <GitFork className="h-3 w-3" />
        Forked
      </span>
    );
  }

  if (isSystemEvaluator(evaluator)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 px-2 py-0.5 text-[11px] font-medium text-purple-400">
        <Shield className="h-3 w-3" />
        System
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-400">
      <Star className="h-3 w-3" />
      Custom
    </span>
  );
}

export function InsideSalesEvaluatorDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [editEvaluator, setEditEvaluator] = useState<EvaluatorDefinition | undefined>();
  const currentUser = useAuthStore((state) => state.user);

  const {
    evaluators,
    isLoaded,
    currentAppId,
    currentListingId,
    loadAppEvaluators,
    updateEvaluator,
    forkEvaluator,
  } = useEvaluatorsStore();

  useEffect(() => {
    if (!isLoaded || currentAppId !== 'inside-sales' || currentListingId !== null) {
      loadAppEvaluators('inside-sales');
    }
  }, [currentAppId, currentListingId, isLoaded, loadAppEvaluators]);

  const evaluator = useMemo(
    () => evaluators.find((entry) => entry.id === id),
    [evaluators, id],
  );
  const canEdit = Boolean(
    evaluator &&
    currentUser &&
    evaluator.tenantId === currentUser.tenantId &&
    evaluator.userId === currentUser.id,
  );

  const handleFork = async () => {
    if (!evaluator) {
      return;
    }

    const forked = await forkEvaluator(evaluator.id);
    notificationService.success(`Forked evaluator: ${forked.name}`);
    setEditEvaluator(forked);
    setShowCreateWizard(true);
  };

  const handleSave = async (nextEvaluator: EvaluatorDefinition) => {
    await updateEvaluator(nextEvaluator);
    notificationService.success('Evaluator updated');
    setEditEvaluator(undefined);
  };

  if (!isLoaded) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--color-brand-accent)]" />
      </div>
    );
  }

  if (!evaluator) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={Pencil}
          title="Evaluator not found"
          description="This evaluator does not exist or is no longer available."
          action={{
            label: 'Back to Evaluators',
            onClick: () => navigate(routes.insideSales.evaluators),
          }}
          className="w-full max-w-md"
        />
      </div>
    );
  }

  const schema = evaluator.outputSchema;
  const dimensions = schema.filter((field) => field.type === 'number' && !field.isMainMetric);
  const complianceGates = schema.filter((field) => field.type === 'boolean');
  const passThreshold = getPassThreshold(schema);
  const excellentThreshold = getExcellentThreshold(schema);

  const scoringTab = {
    id: 'scoring',
    label: 'Scoring Criteria',
    content: (
      <div className="space-y-3 py-3">
        {dimensions.map((dimension) => {
          const match = dimension.description?.match(/\(max (\d+)\)/);
          const maxPoints = match ? match[1] : '?';
          const name = dimension.description?.replace(/\s*\(max \d+\)/, '') || dimension.key;

          return (
            <div
              key={dimension.key}
              className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-primary)]">{name}</span>
                <span className="rounded-full bg-[var(--color-brand-accent)]/20 px-2 py-0.5 text-[11px] font-bold text-[var(--text-brand)]">
                  {maxPoints} pts
                </span>
              </div>
              {dimension.thresholds && (
                <div className="mt-1.5 flex gap-2 text-[10px] text-[var(--text-muted)]">
                  <span>Green ≥ {dimension.thresholds.green}</span>
                  <span>Yellow ≥ {dimension.thresholds.yellow}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    ),
  };

  const complianceTab = {
    id: 'compliance',
    label: 'Compliance & Thresholds',
    content: (
      <div className="space-y-4 py-3">
        {complianceGates.length > 0 && (
          <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-red-400" />
              <span className="text-xs font-semibold text-red-400">Compliance Gates</span>
            </div>
            <ul className="space-y-1.5">
              {complianceGates.map((gate) => (
                <li key={gate.key} className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                  {gate.description}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">Interpretation Bands</h3>
          <div className="grid grid-cols-2 gap-2">
            <ThresholdCard color="emerald" label="Strong" range="80-100" description="Ready for independent calling" />
            <ThresholdCard color="blue" label="Good" range="65-79" description="Minor coaching points" />
            <ThresholdCard color="amber" label="Needs Work" range="50-64" description="Structured coaching required" />
            <ThresholdCard color="red" label="Poor" range="Below 50" description="Re-training recommended" />
          </div>
        </div>

        {passThreshold !== null && excellentThreshold !== null && (
          <div className="text-xs text-[var(--text-muted)]">
            Pass threshold: <strong className="text-[var(--text-primary)]">{passThreshold}</strong>
            {' · '}
            Excellent threshold: <strong className="text-[var(--text-primary)]">{excellentThreshold}</strong>
          </div>
        )}
      </div>
    ),
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="shrink-0">
          <button
            onClick={() => navigate(routes.insideSales.evaluators)}
            className="flex items-center gap-1 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Evaluators
          </button>
        </div>

        <div className="shrink-0 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-[var(--text-primary)]">{evaluator.name}</h1>
              <TypeBadge evaluator={evaluator} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!canEdit ? (
              <Button variant="secondary" size="sm" onClick={handleFork}>
                <GitFork className="h-3.5 w-3.5" />
                Fork & Edit
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditEvaluator(evaluator);
                  setShowCreateWizard(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </div>
        </div>

        <div className="shrink-0 flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
          <span>{getDimensionCount(schema)} dimensions</span>
          <span>{getTotalPoints(schema)} total pts</span>
          {passThreshold !== null && <span>Pass ≥ {passThreshold}</span>}
          {excellentThreshold !== null && <span>Excellent ≥ {excellentThreshold}</span>}
          <span>{getComplianceCount(schema)} compliance gates</span>
        </div>

        <Tabs tabs={[scoringTab, complianceTab]} defaultTab="scoring" fillHeight />
      </div>

      {showCreateWizard ? (
        <CreateEvaluatorWizard
          isOpen={showCreateWizard}
          onClose={() => {
            setShowCreateWizard(false);
            setEditEvaluator(undefined);
          }}
          onSave={handleSave}
          context={{ appId: 'inside-sales' }}
          editEvaluator={editEvaluator}
        />
      ) : null}
    </>
  );
}

function ThresholdCard({
  color,
  label,
  range,
  description,
}: {
  color: string;
  label: string;
  range: string;
  description: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    amber: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400',
  };

  return (
    <div className={cn('rounded-md border p-2.5', colorMap[color])}>
      <div className="text-xs font-semibold">{label}</div>
      <div className="text-[11px] font-mono">{range}</div>
      <div className="mt-0.5 text-[10px] opacity-80">{description}</div>
    </div>
  );
}
