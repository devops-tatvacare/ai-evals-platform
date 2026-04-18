import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, BookmarkPlus, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { Button, Tooltip, ConfirmDialog } from '@/components/ui';
import { PermissionGate } from '@/components/auth/PermissionGate';
import type { AdversarialEvalRow, AdversarialResult, ChatMessage, Run } from '@/types';
import { fetchRun, fetchRunAdversarial } from '@/services/api/evalRunsApi';
import { adversarialTestCasesApi, buildSavedCasePayloadFromResult } from '@/services/api/adversarialTestCasesApi';
import { notificationService } from '@/services/notifications';
import { unwrapSerializedDates } from '@/utils/evalFormatters';
import { humanize } from '@/utils/evalFormatters';
import { Tabs } from '@/components/ui/Tabs';
import { VerdictBadge } from '../components';
import { routes } from '@/config/routes';
import {
  LinkedChatViewer,
  RuleComplianceTab,
  AdversarialOverviewTab,
} from '../components/threadReview';
import { AdversarialPersonaPostureCard } from '../components/AdversarialPersonaPostureCard';
import { PERSONA_CATALOG } from '../components/personaCatalog';
import { useSubmitAndRedirect } from '@/hooks/useSubmitAndRedirect';
import { useAppSettingsStore, useGlobalSettingsStore } from '@/stores';
import { buildAdversarialRetryParams, canSubmitAdversarialRun } from '../utils/adversarialRunParams';
import { getCanonicalAdversarialCase } from '../utils/adversarialCanonical';

/** Normalize adversarial TranscriptTurns into ChatMessage[] so LinkedChatViewer works unmodified. */
function transcriptToMessages(result: AdversarialResult): ChatMessage[] {
  const turns = result.transcript?.turns;
  if (!turns?.length) return [];
  return turns.map(t => ({
    query_text: t.user_message,
    final_response_message: t.bot_response,
    intent_detected: t.detected_intent || '',
    has_image: false,
    timestamp: '',
  }));
}

export default function AdversarialDetailV2() {
  const { runId, evalId } = useParams<{ runId: string; evalId: string }>();
  const navigate = useNavigate();
  const kairaSettings = useAppSettingsStore((s) => s.settings['kaira-bot']);
  const timeouts = useGlobalSettingsStore((s) => s.timeouts);
  const [evalItem, setEvalItem] = useState<AdversarialEvalRow | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [siblingIds, setSiblingIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const [showRetryConfirm, setShowRetryConfirm] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const { submit: submitAdversarialRetry, isSubmitting: retryingCase } = useSubmitAndRedirect({
    appId: 'kaira-bot',
    label: 'Adversarial Case Retry',
    successMessage: 'Adversarial case retry submitted. It will appear in the runs list shortly.',
    fallbackRoute: routes.kaira.runs,
    onClose: () => {},
  });

  useEffect(() => {
    if (!runId) return;
    Promise.all([fetchRun(runId), fetchRunAdversarial(runId)])
      .then(([runResponse, evaluationsResponse]) => {
        setRun(runResponse);
        const match = evaluationsResponse.evaluations.find((e) => String(e.id) === evalId);
        setEvalItem(match ?? evaluationsResponse.evaluations[0] ?? null);
        setSiblingIds(evaluationsResponse.evaluations.map((e) => String(e.id)));
      })
      .catch((e: Error) => setError(e.message));
  }, [runId, evalId]);

  const siblingIndex = siblingIds.indexOf(evalId ?? '');
  const prevId = siblingIndex > 0 ? siblingIds[siblingIndex - 1] : null;
  const nextId = siblingIndex >= 0 && siblingIndex < siblingIds.length - 1 ? siblingIds[siblingIndex + 1] : null;

  const goTo = useCallback(
    (id: string) => runId && navigate(routes.kaira.adversarialDetail(runId, id)),
    [runId, navigate],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowLeft' && prevId) { e.preventDefault(); goTo(prevId); }
      if (e.key === 'ArrowRight' && nextId) { e.preventDefault(); goTo(nextId); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prevId, nextId, goTo]);

  const result = useMemo(
    () => evalItem ? unwrapSerializedDates(evalItem.result) as AdversarialResult : null,
    [evalItem],
  );

  const messages = useMemo(
    () => result ? transcriptToMessages(result) : [],
    [result],
  );
  const canonicalCase = useMemo(
    () => result ? getCanonicalAdversarialCase(result, evalItem ?? undefined) : null,
    [evalItem, result],
  );

  // Empty maps — adversarial has no per-turn correctness/intent/friction
  const emptyCorrectnessMap = useMemo(() => new Map(), []);
  const emptyIntentMap = useMemo(() => new Map(), []);
  const emptyFrictionSet = useMemo(() => new Set<number>(), []);

  const verdict = canonicalCase?.judge.verdict ?? evalItem?.verdict ?? null;
  const infraError = evalItem?.error ?? result?.error ?? null;
  const hasRules = (result?.rule_compliance?.length ?? 0) > 0;
  const canRetryCase = Boolean(run && evalItem && canonicalCase?.derived.isRetryable);

  const handleRetryCase = useCallback(async () => {
    if (!run || !evalItem) return;
    if (!canSubmitAdversarialRun(kairaSettings, run)) {
      notificationService.error(
        'Configure a Kaira API URL and at least one credential row before retrying adversarial cases.',
        'Missing Kaira settings',
      );
      return;
    }

    await submitAdversarialRetry(
      'evaluate-adversarial',
      buildAdversarialRetryParams({
        run,
        kairaSettings,
        timeouts,
        retryEvalIds: [evalItem.id],
        sourceRunId: run.run_id,
        nameSuffix: ` Case ${evalItem.id} Retry`,
      }),
    );
  }, [evalItem, kairaSettings, run, submitAdversarialRetry, timeouts]);

  const handleSaveToLibrary = useCallback(async () => {
    if (!result || !run) return;

    setSavingToLibrary(true);
    try {
      const primaryGoal = result.test_case.goal_flow?.length
        ? result.test_case.goal_flow.map(humanize).join(' → ')
        : 'Adversarial Case';
      await adversarialTestCasesApi.create(
        buildSavedCasePayloadFromResult(result, {
          name: `${primaryGoal} · ${result.test_case.difficulty}`,
          description: `Saved from run ${run.run_id.slice(0, 8)} case ${evalItem?.id ?? ''}`.trim(),
          sourceKind: 'generated',
          createdFromRunId: run.run_id,
          createdFromEvalId: evalItem?.id,
        }),
      );
      notificationService.success('Test case saved to the adversarial library.');
    } catch (e: unknown) {
      notificationService.error(
        e instanceof Error ? e.message : 'Failed to save adversarial case.',
        'Save failed',
      );
    } finally {
      setSavingToLibrary(false);
    }
  }, [evalItem?.id, result, run]);

  const tabs = useMemo(() => {
    if (!result) return [];

    const tabList = [
      {
        id: 'overview',
        label: 'Overview',
        content: (
          <AdversarialOverviewTab
            result={result}
            canonicalCase={canonicalCase}
            verdict={verdict}
            infraError={infraError}
          />
        ),
      },
    ];

    if (hasRules) {
      tabList.push({
        id: 'rules',
        label: 'Rules',
        content: (
          <RuleComplianceTab
            rules={result.rule_compliance!}
            sourceLabel="Adversarial"
          />
        ),
      });
    }

    // One posture tab per persona that has either tactics attempted or
    // persona.* rules evaluated on this case. Purely data-driven — no
    // Moriarty-specific conditional.
    for (const persona of PERSONA_CATALOG) {
      if (persona.tactics.length === 0) continue;
      const hasTacticData = (result.persona_tactic_summary?.tactics_attempted?.length ?? 0) > 0;
      const hasRuleData = (result.rule_compliance ?? []).some((rc) =>
        (rc.rule_id ?? '').startsWith(`persona.${persona.id}.`),
      );
      if (!hasTacticData && !hasRuleData) continue;
      tabList.push({
        id: `posture-${persona.id}`,
        label: `${persona.label} Posture`,
        content: (
          <AdversarialPersonaPostureCard personaId={persona.id} result={result} />
        ),
      });
    }

    return tabList;
  }, [result, verdict, infraError, hasRules, canonicalCase]);

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-sm text-[var(--color-error)]">
        {error}
      </div>
    );
  }

  if (!evalItem || !result) {
    return <div className="text-sm text-[var(--text-muted)] text-center py-8">Loading...</div>;
  }

  const tc = result.test_case;
  const turnCount = canonicalCase?.facts.transcript.turnCount ?? result.transcript?.total_turns ?? messages.length;
  const judgeGoalAchieved = canonicalCase?.judge.goalAchieved ?? false;
  const contradictionTypes = canonicalCase?.derived.contradictionTypes ?? [];
  const failureModes = canonicalCase?.judge.failureModes ?? result.failure_modes ?? [];
  const goalVerdicts = canonicalCase?.judge.goalVerdicts ?? [];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="shrink-0 pb-3 space-y-3">
        <nav className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <Link to={routes.kaira.runs} className="hover:text-[var(--text-brand)] transition-colors">Runs</Link>
          <span>/</span>
          <Link
            to={routes.kaira.runDetail(runId!)}
            className="hover:text-[var(--text-brand)] transition-colors font-mono"
          >
            {runId?.slice(0, 12)}
          </Link>
          <span>/</span>
          <span className="font-medium text-[var(--text-primary)]">Adversarial</span>

          {/* Prev / Next navigation */}
          {siblingIds.length > 1 && (
            <span className="inline-flex items-center gap-0.5 ml-2 border border-[var(--border-subtle)] rounded-md bg-[var(--bg-secondary)]">
              <button
                disabled={!prevId}
                onClick={() => prevId && goTo(prevId)}
                className="p-1 disabled:opacity-30 hover:bg-[var(--surface-hover)] rounded-l-md transition-colors cursor-pointer disabled:cursor-default"
                title={prevId ? 'Previous test (Alt+\u2190)' : 'No previous test'}
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-[10px] tabular-nums px-1 border-x border-[var(--border-subtle)]">
                {siblingIndex + 1}/{siblingIds.length}
              </span>
              <button
                disabled={!nextId}
                onClick={() => nextId && goTo(nextId)}
                className="p-1 disabled:opacity-30 hover:bg-[var(--surface-hover)] rounded-r-md transition-colors cursor-pointer disabled:cursor-default"
                title={nextId ? 'Next test (Alt+\u2192)' : 'No next test'}
              >
                <ChevronRight size={14} />
              </button>
            </span>
          )}
        </nav>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div
            className="inline-flex flex-wrap items-stretch rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-sm"
          >
            {verdict && (
              <div className="flex flex-col items-center justify-center gap-0.5 px-4 py-2">
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-none">Verdict</span>
                <span className="leading-none"><VerdictBadge verdict={verdict} category="adversarial" /></span>
              </div>
            )}
            <div className={`flex flex-col items-center justify-center gap-0.5 px-4 py-2 ${verdict ? 'border-l border-[var(--border-subtle)]' : ''}`}>
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-none">Difficulty</span>
              <span className="leading-none"><VerdictBadge verdict={tc.difficulty} category="difficulty" /></span>
            </div>
            <div className="flex flex-col items-center justify-center gap-0.5 px-4 py-2 border-l border-[var(--border-subtle)]">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-none">Goal Flow</span>
              <span className="font-medium text-[var(--text-primary)] leading-none">{(tc.goal_flow || []).map(humanize).join(' → ')}</span>
            </div>
            <div className="flex flex-col items-center justify-center gap-0.5 px-4 py-2 border-l border-[var(--border-subtle)]">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-none">Turns</span>
              <span className="font-medium text-[var(--text-primary)] leading-none">{turnCount}</span>
            </div>
            <div className="flex flex-col items-center justify-center gap-0.5 px-4 py-2 border-l border-[var(--border-subtle)]">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-none">Judge Goal</span>
              <span className="font-semibold leading-none" style={{ color: judgeGoalAchieved ? 'var(--color-success)' : 'var(--color-error)' }}>
                  {judgeGoalAchieved ? '\u2713 Achieved' : '\u2717 Not Achieved'}
                </span>
              </div>
            {failureModes.length > 0 && (
              <div className="flex flex-col items-center justify-center gap-0.5 px-4 py-2 border-l border-[var(--border-subtle)]">
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-none">Failures</span>
                <span className="font-semibold leading-none text-[var(--color-error)]">{failureModes.length}</span>
              </div>
            )}
            {canonicalCase?.derived.hasContradiction && (
              <div className="flex flex-col items-center justify-center gap-0.5 px-4 py-2 border-l border-[var(--border-subtle)]">
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-none">Warnings</span>
                <span className="font-semibold leading-none text-[var(--color-warning)]">{contradictionTypes.length}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <PermissionGate action="configuration:edit">
              <Tooltip content="Save this test case to the adversarial library for reuse in future runs.">
                <Button
                  variant="secondary"
                  icon={BookmarkPlus}
                  onClick={() => { void handleSaveToLibrary(); }}
                  isLoading={savingToLibrary}
                >
                  Save To Library
                </Button>
              </Tooltip>
            </PermissionGate>
            <PermissionGate action="evaluation:run">
              <Tooltip
                content={
                  canRetryCase
                    ? 'Re-run this test case with the same parameters against the live bot.'
                    : 'Retry is only available for cases flagged as infrastructure failures or contradictions.'
                }
              >
                <Button
                  variant="secondary"
                  icon={RotateCcw}
                  onClick={() => setShowRetryConfirm(true)}
                  disabled={!canRetryCase}
                  isLoading={retryingCase}
                >
                  Retry Case
                </Button>
              </Tooltip>
            </PermissionGate>
          </div>
        </div>

        {(goalVerdicts.length > 0 || failureModes.length > 0 || contradictionTypes.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            {goalVerdicts.map((goal) => (
              <span
                key={goal.goalId}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                  goal.achieved
                    ? 'border-[var(--border-success)] bg-[var(--surface-success)] text-[var(--color-success)]'
                    : 'border-[var(--border-error)] bg-[var(--surface-error)] text-[var(--color-error)]'
                }`}
              >
                {humanize(goal.goalId)}: {goal.achieved ? 'Achieved' : 'Failed'}
              </span>
            ))}
            {failureModes.map((failureMode) => (
              <span
                key={failureMode}
                className="inline-flex items-center rounded-full border border-[var(--border-error)] bg-[var(--surface-error)] px-2.5 py-1 text-xs font-medium text-[var(--color-error)]"
              >
                {humanize(failureMode)}
              </span>
            ))}
            {contradictionTypes.map((contradictionType) => (
              <span
                key={contradictionType}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-warning)] bg-[var(--surface-warning)] px-2.5 py-1 text-xs font-medium text-[var(--color-warning)]"
              >
                <AlertTriangle className="h-3 w-3" />
                {humanize(contradictionType)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Body — split pane */}
      <>
        {/* Mobile: stacked */}
        <div className="flex flex-col flex-1 min-h-0 md:hidden">
          {messages.length > 0 && (
            <details className="shrink-0" open>
              <summary className="text-xs text-[var(--text-muted)] font-medium cursor-pointer py-1.5 px-1">
                Transcript ({turnCount} turns)
              </summary>
              <div className="max-h-[400px] overflow-y-auto">
                <LinkedChatViewer
                  messages={messages}
                  correctnessMap={emptyCorrectnessMap}
                  intentMap={emptyIntentMap}
                  frictionTurns={emptyFrictionSet}
                  activeTurnIndex={null}
                  onTurnClick={() => {}}
                  chatContainerRef={chatContainerRef}
                />
              </div>
            </details>
          )}
          <div className="flex-1 min-h-0">
            <Tabs tabs={tabs} defaultTab="overview" fillHeight />
          </div>
        </div>

        {/* Desktop: side-by-side */}
        <div className="hidden md:flex flex-1 min-h-0">
          {messages.length > 0 && (
            <div className="w-[35%] min-w-[280px] max-w-[420px] flex flex-col min-h-0 border-r border-[var(--border-subtle)]">
              <div className="flex-1 min-h-0 overflow-y-auto">
                <LinkedChatViewer
                  messages={messages}
                  correctnessMap={emptyCorrectnessMap}
                  intentMap={emptyIntentMap}
                  frictionTurns={emptyFrictionSet}
                  activeTurnIndex={null}
                  onTurnClick={() => {}}
                  chatContainerRef={chatContainerRef}
                />
              </div>
            </div>
          )}

          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            <Tabs tabs={tabs} defaultTab="overview" fillHeight />
          </div>
        </div>
      </>

      <ConfirmDialog
        isOpen={showRetryConfirm}
        onClose={() => setShowRetryConfirm(false)}
        onConfirm={() => {
          setShowRetryConfirm(false);
          void handleRetryCase();
        }}
        title="Retry Adversarial Case"
        description="This will re-run the test case against the live bot with the same parameters. A new evaluation run will be created."
        confirmLabel="Retry"
        variant="warning"
        isLoading={retryingCase}
        icon={RotateCcw}
      />
    </div>
  );
}
