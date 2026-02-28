import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Exemplars, ExemplarThread, NarrativeOutput, ExemplarAnalysis } from '@/types/reports';
import { cn } from '@/utils/cn';
import SectionHeader from './shared/SectionHeader';
import { VerdictBadge } from '../../components';

interface Props {
  exemplars: Exemplars;
  narrative: NarrativeOutput | null;
  isAdversarial?: boolean;
}

export default function ExemplarThreads({ exemplars, narrative, isAdversarial }: Props) {
  const analysisMap = new Map<string, ExemplarAnalysis>();
  if (narrative?.exemplarAnalysis) {
    for (const ea of narrative.exemplarAnalysis) {
      analysisMap.set(ea.threadId, ea);
    }
  }

  return (
    <section>
      <SectionHeader
        title={isAdversarial ? 'Exemplar Test Cases' : 'Exemplar Threads'}
        description={isAdversarial
          ? 'Representative best and worst adversarial test cases with AI analysis'
          : 'Representative best and worst threads with AI analysis'
        }
      />

      {exemplars.best.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-[var(--color-success)] mb-3">Best Examples</h3>
          <div className="space-y-3">
            {exemplars.best.map((thread) => (
              <ThreadCard
                key={thread.threadId}
                thread={thread}
                type="good"
                analysis={analysisMap.get(thread.threadId)}
                isAdversarial={isAdversarial}
              />
            ))}
          </div>
        </div>
      )}

      {exemplars.worst.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-error)] mb-3">Worst Examples</h3>
          <div className="space-y-3">
            {exemplars.worst.map((thread) => (
              <ThreadCard
                key={thread.threadId}
                thread={thread}
                type="bad"
                analysis={analysisMap.get(thread.threadId)}
                isAdversarial={isAdversarial}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Thread diagnostic card ─────────────────────────────────────

function ThreadCard({ thread, type, analysis, isAdversarial }: {
  thread: ExemplarThread;
  type: 'good' | 'bad';
  analysis?: ExemplarAnalysis;
  isAdversarial?: boolean;
}) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const isGood = type === 'good';
  const validMessages = thread.transcript.filter((m) => m.content.trim() !== '');
  const isAdversarialExemplar = isAdversarial || !!thread.category;

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden',
        isGood
          ? 'border-l-[3px] border-l-[var(--color-success)] border-[var(--border-subtle)]'
          : 'border-l-[3px] border-l-[var(--color-error)] border-[var(--border-subtle)]',
      )}
    >
      {/* Header strip */}
      <div
        className={cn(
          'flex items-center gap-2 px-4 py-2',
          isGood ? 'bg-[var(--surface-success)]' : 'bg-[var(--surface-error)]',
        )}
      >
        <span
          className={cn(
            'text-[10px] font-bold uppercase tracking-wider',
            isGood ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]',
          )}
        >
          {isGood ? 'Best' : 'Worst'}
        </span>
        <span className="text-xs font-mono text-[var(--text-muted)]">
          {thread.threadId.slice(0, 12)}
        </span>
        <div className="flex items-center gap-1 ml-auto flex-wrap justify-end">
          {/* Adversarial badges */}
          {isAdversarialExemplar && thread.category && (
            <span className="px-1.5 py-px text-[10px] font-semibold rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              {thread.category}
            </span>
          )}
          {isAdversarialExemplar && thread.difficulty && (
            <span className={cn(
              'px-1.5 py-px text-[10px] font-semibold rounded-full',
              thread.difficulty === 'HARD' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
              thread.difficulty === 'MEDIUM' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
              'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
            )}>
              {thread.difficulty}
            </span>
          )}
          {thread.correctnessVerdict && <VerdictBadge verdict={thread.correctnessVerdict} />}
          <span
            className={cn(
              'px-1.5 py-px text-[10px] font-semibold rounded-full',
              thread.taskCompleted
                ? 'bg-[var(--surface-success)] text-[var(--color-success)]'
                : 'bg-[var(--surface-error)] text-[var(--color-error)]',
            )}
          >
            {isAdversarialExemplar
              ? (thread.goalAchieved ? 'Goal Achieved' : 'Goal Failed')
              : (thread.taskCompleted ? 'Complete' : 'Incomplete')
            }
          </span>
        </div>
      </div>

      {/* Body — AI analysis always visible */}
      <div className="px-4 py-3 bg-[var(--bg-primary)]">
        {/* Adversarial-specific: reasoning and failure modes */}
        {isAdversarialExemplar && (thread.reasoning || (thread.failureModes && thread.failureModes.length > 0)) && (
          <div className="mb-3">
            {thread.reasoning && (
              <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-0.5">
                  Reasoning
                </span>
                {thread.reasoning}
              </p>
            )}
            {thread.failureModes && thread.failureModes.length > 0 && (
              <div className="mb-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                  Failure Modes
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {thread.failureModes.map((mode, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
                    >
                      {mode}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* AI Analysis as structured prose */}
        {analysis ? (
          <div className="mb-3">
            <p className="text-[13px] text-[var(--text-primary)] leading-relaxed mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-0.5">
                {isGood ? 'What happened' : 'What went wrong'}
              </span>
              {analysis.whatHappened}
            </p>
            <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-0.5">
                {isGood ? 'Why it worked' : 'Why it failed'}
              </span>
              {analysis.why}
            </p>
            {analysis.promptGap && (
              <p className="text-xs text-[var(--text-muted)] italic mt-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] mr-1 align-middle" />
                Prompt gap: {analysis.promptGap}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)] italic mb-3">
            {isAdversarialExemplar ? 'AI analysis not available for this test case.' : 'AI analysis not available for this thread.'}
          </p>
        )}

        {/* Rule violations as chips (bad examples only) */}
        {!isGood && thread.ruleViolations.length > 0 && (
          <div className="mb-3">
            <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
              Rule Violations
            </p>
            <div className="flex flex-wrap gap-1.5">
              {thread.ruleViolations.map((v, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-2 py-0.5 text-[11px] font-mono font-semibold rounded bg-[var(--surface-error)] text-[var(--color-error)] border border-red-200"
                  title={v.evidence || undefined}
                >
                  {v.ruleId}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Expandable transcript */}
        {validMessages.length > 0 && (
          <div className="border-t border-[var(--border-subtle)] pt-2.5">
            <button
              onClick={() => setTranscriptOpen(!transcriptOpen)}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              {transcriptOpen
                ? <ChevronDown className="h-3 w-3" />
                : <ChevronRight className="h-3 w-3" />
              }
              Transcript
              <span className="font-normal">({validMessages.length} messages)</span>
            </button>
            {transcriptOpen && (
              <div className="exemplar-transcript mt-2">
                <Transcript messages={validMessages} isGood={isGood} />
              </div>
            )}
            {/* Print: always show transcript (hidden on screen when collapsed) */}
            {!transcriptOpen && (
              <div className="exemplar-transcript hidden mt-2">
                <Transcript messages={validMessages} isGood={isGood} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Transcript rendering ───────────────────────────────────────

function Transcript({ messages, isGood }: { messages: { role: string; content: string }[]; isGood: boolean }) {
  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto">
      {messages.map((msg, i) => (
        <TranscriptBubble key={i} msg={msg} isGood={isGood} />
      ))}
    </div>
  );
}

function TranscriptBubble({ msg, isGood }: {
  msg: { role: string; content: string };
  isGood: boolean;
}) {
  const MAX_LENGTH = 500;
  const [showFull, setShowFull] = useState(false);
  const isUser = msg.role === 'user';
  const truncated = msg.content.length > MAX_LENGTH && !showFull;
  const display = truncated ? msg.content.slice(0, MAX_LENGTH) + '...' : msg.content;

  return (
    <div
      className={cn(
        'border-l-2 rounded-r px-3 py-2',
        isUser
          ? 'border-l-blue-400 bg-blue-50 dark:bg-blue-900/20'
          : isGood
            ? 'border-l-green-400 bg-green-50 dark:bg-green-900/20'
            : 'border-l-red-400 bg-red-50 dark:bg-red-900/20',
      )}
    >
      <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)] mb-0.5">
        {msg.role}
      </p>
      <p className="text-xs font-mono whitespace-pre-wrap text-[var(--text-primary)] leading-relaxed">
        {display}
      </p>
      {msg.content.length > MAX_LENGTH && (
        <button
          onClick={() => setShowFull(!showFull)}
          className="text-xs text-[var(--text-brand)] hover:underline mt-1"
        >
          {showFull ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
