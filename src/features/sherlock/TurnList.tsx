/** Turn-grouped chat renderer: avatars, specialist blocks, charts, cost, copy.
 *  Pure render over the flat typed Part stream — streamStore stays the only state. */
import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui';
import { cn } from '@/utils/cn';
import { useAuthStore } from '@/stores/authStore';
import { CostChip } from '@/features/cost/components/CostChip';
import { ThinkingIndicator } from '@/features/chat-widget/components/ThinkingIndicator';

import { Avatar } from './components/Avatar';
import { CopyButton } from './components/CopyButton';
import { getUserInitials } from './initials';
import { SpecialistGroup, type SpecialistPart } from './components/SpecialistGroup';
import {
  AssistantMarkdown,
  ChartCard,
  CompactionMarker,
  ErrorBanner,
  ReasoningBlock,
} from './components/parts';
import { phrasesForContext } from './contextualPhrases';
import { groupPartsIntoTurns, type Turn } from './grouping';
import type { AssistantTextPart, SherlockPart } from './generated/sherlockContract';

interface TurnListProps {
  parts: SherlockPart[];
  appId: string;
  sessionId: string | null;
  streaming: boolean;
  onRetry: () => void;
}

const FAILED_STATUSES = new Set(['error', 'degraded', 'interrupted', 'failed']);

function isSpecialistPart(part: SherlockPart): part is SpecialistPart {
  return part.type === 'subtask' || part.type === 'retry';
}

function AssistantAnswer({ part }: { part: AssistantTextPart }) {
  const text = part.text ?? '';
  return (
    <div className="group relative">
      <AssistantMarkdown part={part} />
      {text.trim() ? (
        <div className="absolute -right-1 -top-1">
          <CopyButton text={text} />
        </div>
      ) : null}
    </div>
  );
}

function renderAssistantBody(turn: Turn, appId: string, sessionId: string | null, settled: boolean) {
  const blocks: React.ReactNode[] = [];
  let run: SpecialistPart[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    blocks.push(<SpecialistGroup key={`sg-${run[0].id}`} parts={run} settled={settled} />);
    run = [];
  };

  for (const part of turn.parts) {
    // submit_sql ToolParts are admin-trace only; their sql/rows surface on the
    // data specialist's subtask row, so they're not drawn in the chat.
    if (part.type === 'tool') continue;
    if (isSpecialistPart(part)) {
      run.push(part);
      continue;
    }
    flushRun();
    switch (part.type) {
      case 'assistant_text':
        blocks.push(<AssistantAnswer key={part.id} part={part} />);
        break;
      case 'reasoning':
        blocks.push(<ReasoningBlock key={part.id} part={part} />);
        break;
      case 'chart':
        blocks.push(<ChartCard key={part.id} part={part} appId={appId} sessionId={sessionId} />);
        break;
      case 'error':
        blocks.push(<ErrorBanner key={part.id} part={part} />);
        break;
      case 'compaction':
        blocks.push(<CompactionMarker key={part.id} part={part} />);
        break;
    }
  }
  flushRun();
  return blocks;
}

function UserTurn({ turn, initials }: { turn: Turn; initials: string }) {
  const text = turn.parts
    .map((p) => (p.type === 'user_message' ? p.text : ''))
    .join('');
  return (
    <div className="ml-auto flex max-w-[88%] flex-row-reverse gap-3">
      <Avatar role="user" initials={initials} />
      <div className="rounded-2xl rounded-br-md border border-[color-mix(in_srgb,var(--interactive-primary)_35%,transparent)] bg-[color-mix(in_srgb,var(--interactive-primary)_14%,var(--bg-primary))] px-4 py-3 text-[13px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap break-words">
        {text}
      </div>
    </div>
  );
}

function AssistantTurn({
  turn,
  appId,
  sessionId,
  streaming,
  isLast,
  onRetry,
}: {
  turn: Turn;
  appId: string;
  sessionId: string | null;
  streaming: boolean;
  isLast: boolean;
  onRetry: () => void;
}) {
  const status = turn.stepFinish?.status;
  const failed = status ? FAILED_STATUSES.has(status) : false;
  const turnId = turn.stepFinish?.turn_id ?? null;
  // The live turn is the last one still streaming with no step_finish yet.
  // While live, specialist groups stay expanded (settled=false); they collapse
  // to a one-line summary only once the turn returns to the supervisor (done).
  const isLiveTurn = streaming && isLast && !turn.stepFinish;
  const settled = !isLiveTurn;
  // The shimmer narrates specialist work; once the final answer starts
  // streaming it owns the space, so the shimmer steps aside (no glass below
  // the growing answer).
  const answerStreaming = turn.parts.some((p) => p.type === 'assistant_text');
  const showThinking = isLiveTurn && !answerStreaming;
  const showRetry = isLast && failed;

  return (
    <div className="mr-auto flex w-full gap-2.5">
      <Avatar role="assistant" initials="" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
          Sherlock
          {status && status !== 'done' ? (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] capitalize tracking-normal',
                failed
                  ? 'bg-[color-mix(in_srgb,var(--interactive-danger)_14%,transparent)] text-[var(--interactive-danger)]'
                  : 'bg-[var(--bg-secondary)]',
              )}
            >
              {status}
            </span>
          ) : null}
          {turnId ? (
            <CostChip ownerType="sherlock_turn" ownerId={turnId} className="lowercase" />
          ) : null}
        </div>

        {renderAssistantBody(turn, appId, sessionId, settled)}

        {showThinking ? <ThinkingIndicator phrases={phrasesForContext(turn.parts)} /> : null}

        {showRetry ? (
          <div className="flex items-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--interactive-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--interactive-danger)_6%,var(--bg-primary))] px-4 py-3 text-[13px] text-[var(--text-primary)]">
            <div className="min-w-0 flex-1">
              <div className="font-medium capitalize">{status ?? 'error'}</div>
              <div className="text-xs text-[var(--text-muted)]">Retry the last prompt to continue.</div>
            </div>
            <Button variant="ghost" size="sm" icon={RotateCcw} onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function TurnList({ parts, appId, sessionId, streaming, onRetry }: TurnListProps) {
  const displayName = useAuthStore((s) => s.user?.displayName);
  const initials = getUserInitials(displayName);
  const turns = groupPartsIntoTurns(parts);
  const last = turns[turns.length - 1];
  const trailingThinking = streaming && (!last || last.role === 'user');

  return (
    <div className="flex flex-col gap-5">
      {turns.map((turn, i) => {
        const isLast = i === turns.length - 1;
        if (turn.role === 'user') {
          return <UserTurn key={turn.id} turn={turn} initials={initials} />;
        }
        return (
          <AssistantTurn
            key={turn.id}
            turn={turn}
            appId={appId}
            sessionId={sessionId}
            streaming={streaming}
            isLast={isLast}
            onRetry={onRetry}
          />
        );
      })}

      {trailingThinking ? (
        <div className="mr-auto flex w-full gap-2.5">
          <Avatar role="assistant" initials="" />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
              Sherlock
            </div>
            <ThinkingIndicator />
          </div>
        </div>
      ) : null}
    </div>
  );
}
