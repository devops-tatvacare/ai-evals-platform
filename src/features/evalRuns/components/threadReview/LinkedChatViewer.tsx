import type { RefObject } from 'react';
import type { ChatMessage, CorrectnessVerdict } from '@/types/evalRuns';
import { formatChatTimestamp } from '@/utils/evalFormatters';
import { cn } from '@/utils';
import ChatTurnBadges from './ChatTurnBadges';
import type { EvalTab } from './useEvalLinking';

interface Props {
  messages: ChatMessage[];
  correctnessMap: Map<number, CorrectnessVerdict>;
  intentMap: Map<number, boolean>;
  frictionTurns: Set<number>;
  activeTurnIndex: number | null;
  onTurnClick: (turnIndex: number, evalType: EvalTab) => void;
  chatContainerRef: RefObject<HTMLDivElement | null>;
}

export default function LinkedChatViewer({
  messages,
  correctnessMap,
  intentMap,
  frictionTurns,
  activeTurnIndex,
  onTurnClick,
  chatContainerRef,
}: Props) {
  return (
    <div
      ref={chatContainerRef}
      className="flex flex-col gap-0 h-full overflow-y-auto"
    >
      {messages.map((m, i) => {
        const isFriction = frictionTurns.has(i);
        const isActive = activeTurnIndex === i;

        return (
          <div
            key={i}
            id={`thread-turn-${i}`}
            className={cn(
              'flex flex-col gap-1 px-3 py-2 border-l-2 transition-all duration-200',
              isFriction
                ? 'border-l-[var(--color-warning)] bg-[color-mix(in_srgb,var(--color-warning)_4%,transparent)]'
                : 'border-l-transparent',
              isActive && 'ring-2 ring-inset ring-[var(--border-brand)] bg-[var(--surface-info)]',
            )}
          >
            {/* Header row: turn info left, eval annotations right */}
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
              <span className="font-semibold">Turn {i + 1}</span>
              {m.timestamp && <span>{formatChatTimestamp(m.timestamp)}</span>}
              {m.intent_detected && (
                <span className="text-[var(--color-info)]">{m.intent_detected}</span>
              )}
              {m.has_image && (
                <span className="px-1 py-px rounded text-[9px] font-semibold bg-[var(--color-accent-purple)] text-white">
                  IMG
                </span>
              )}
              {isFriction && (
                <span className="text-[var(--color-warning)] font-semibold">Friction</span>
              )}

              {/* Eval annotations — pushed to right */}
              <ChatTurnBadges
                turnIndex={i}
                correctnessVerdict={correctnessMap.get(i)}
                isCorrectIntent={intentMap.get(i)}
                onBadgeClick={onTurnClick}
              />
            </div>

            {/* User / conversation agent message — sender on right */}
            <div className="flex justify-end">
              <div className="bg-[var(--surface-info)] border border-[var(--border-info)] rounded-xl rounded-br-sm px-3 py-1.5 max-w-[85%] text-[13px] leading-relaxed whitespace-pre-wrap break-words text-[var(--text-primary)]">
                {m.query_text}
              </div>
            </div>

            {/* Bot (Kaira) response — recipient on left */}
            <div className="flex justify-start">
              <div className="bg-[var(--bg-tertiary)] rounded-xl rounded-bl-sm px-3 py-1.5 max-w-[85%] text-[13px] leading-relaxed whitespace-pre-wrap break-words text-[var(--text-primary)]">
                {m.final_response_message}
              </div>
            </div>
          </div>
        );
      })}

      {messages.length === 0 && (
        <p className="text-xs text-[var(--text-muted)] text-center py-3">
          No messages available
        </p>
      )}
    </div>
  );
}
