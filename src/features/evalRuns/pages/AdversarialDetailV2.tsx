import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AdversarialEvalRow, AdversarialResult, ChatMessage } from '@/types';
import { fetchRunAdversarial } from '@/services/api/evalRunsApi';
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
  const [evalItem, setEvalItem] = useState<AdversarialEvalRow | null>(null);
  const [siblingIds, setSiblingIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!runId) return;
    fetchRunAdversarial(runId)
      .then((r) => {
        const match = r.evaluations.find((e) => String(e.id) === evalId);
        setEvalItem(match ?? r.evaluations[0] ?? null);
        setSiblingIds(r.evaluations.map((e) => String(e.id)));
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

  // Empty maps — adversarial has no per-turn correctness/intent/friction
  const emptyCorrectnessMap = useMemo(() => new Map(), []);
  const emptyIntentMap = useMemo(() => new Map(), []);
  const emptyFrictionSet = useMemo(() => new Set<number>(), []);

  const verdict = evalItem?.verdict ?? null;
  const infraError = evalItem?.error ?? result?.error ?? null;
  const hasRules = (result?.rule_compliance?.length ?? 0) > 0;

  const tabs = useMemo(() => {
    if (!result) return [];

    const tabList = [
      {
        id: 'overview',
        label: 'Overview',
        content: (
          <AdversarialOverviewTab
            result={result}
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

    return tabList;
  }, [result, verdict, infraError, hasRules]);

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
  const turnCount = result.transcript?.total_turns ?? messages.length;

  return (
    <div className="flex flex-col h-[calc(100vh-var(--header-height,48px))]">
      {/* Header — single row: breadcrumb+nav left, metrics right */}
      <div className="shrink-0 pb-3 flex items-center justify-between gap-4 flex-wrap">
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

        {/* Summary metrics container */}
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
          {result.transcript && (
            <div className="flex flex-col items-center justify-center gap-0.5 px-4 py-2 border-l border-[var(--border-subtle)]">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-none">Goal</span>
              <span className="font-semibold leading-none" style={{ color: result.transcript.goal_achieved ? 'var(--color-success)' : 'var(--color-error)' }}>
                {result.transcript.goal_achieved ? '\u2713 Achieved' : '\u2717 Not Achieved'}
              </span>
            </div>
          )}
          {(result.failure_modes?.length ?? 0) > 0 && (
            <div className="flex flex-col items-center justify-center gap-0.5 px-4 py-2 border-l border-[var(--border-subtle)]">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-none">Failures</span>
              <span className="font-semibold leading-none text-[var(--color-error)]">{result.failure_modes!.length}</span>
            </div>
          )}
        </div>
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
    </div>
  );
}

