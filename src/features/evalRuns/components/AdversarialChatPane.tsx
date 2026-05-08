/**
 * AdversarialChatPane
 *
 * Renders an adversarial run transcript so the chat pane is screenshot-
 * equivalent to the production Goodflip Kaira UI for the same persona script.
 *
 *   - Bot side: prose bubble for `bot_response`. If `assistant_widget` is
 *     present, the widget renders below (or instead of, for empty prose)
 *     using the same component the live chat uses. The user thus sees the
 *     food card / BP card / vitals card / batch food card as actual cards.
 *
 *   - User side: if `user_action` is present, render an ActionPressBubble
 *     (chip with "tapped" affordance) — NOT a typed text bubble. This makes
 *     it visually obvious that the simulator clicked the action button, the
 *     same way a real user does in production. If `user_action` is absent,
 *     render the existing typed-text bubble.
 *
 * No flattening, no `ChatMessage[]` intermediary. Reads `TranscriptTurn[]`
 * directly so the widget data round-trips intact.
 */

import { memo } from 'react';
import { cn } from '@/utils';
import type { TranscriptTurn } from '@/types';
import { ActionPressBubble, rendererFor } from './widgets';

interface Props {
  turns: TranscriptTurn[];
}

export const AdversarialChatPane = memo(function AdversarialChatPane({ turns }: Props) {
  // No own bg/border/rounded chrome — sits flat on the parent canvas. The
  // outer column wrapper in AdversarialDetailV2 owns the scroll container.
  return (
    <div className={cn('flex flex-col gap-4 py-3 px-4')}>
      {turns.length === 0 && (
        <p className="text-xs text-[var(--text-muted)] text-center py-3">
          No transcript turns to display.
        </p>
      )}
      {turns.map((turn) => (
        <Turn key={turn.turn_number} turn={turn} />
      ))}
    </div>
  );
});

function Turn({ turn }: { turn: TranscriptTurn }) {
  const Widget = turn.assistant_widget ? rendererFor(turn.assistant_widget.kind) : null;
  const widgetData = (turn.assistant_widget?.data ?? {}) as Record<string, unknown>;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Turn header */}
      <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
        <span className="font-semibold">Turn {turn.turn_number}</span>
        {turn.detected_intent && (
          <span className="text-[var(--color-info)]">{turn.detected_intent}</span>
        )}
        {turn.user_action && (
          <span className="rounded bg-[var(--surface-info)] px-1.5 py-px text-[var(--color-info)]">
            action turn
          </span>
        )}
      </div>

      {/* User side */}
      {turn.user_action ? (
        <ActionPressBubble
          label={turn.user_action.label}
          kind={turn.user_action.kind}
        />
      ) : (
        <div className="flex justify-end">
          <div className={cn(
            'bg-[var(--surface-info)] border border-[var(--border-info)] rounded-xl rounded-br-sm px-3 py-1.5',
            'max-w-[85%] text-[13px] leading-relaxed whitespace-pre-wrap break-words text-[var(--text-primary)]',
          )}>
            {turn.user_message}
          </div>
        </div>
      )}

      {/* Bot side: prose */}
      {turn.bot_response && (
        <div className="flex justify-start">
          <div className={cn(
            'bg-[var(--bg-tertiary)] rounded-xl rounded-bl-sm px-3 py-1.5',
            'max-w-[85%] text-[13px] leading-relaxed whitespace-pre-wrap break-words text-[var(--text-primary)]',
          )}>
            {turn.bot_response}
          </div>
        </div>
      )}

      {/* Bot side: structured widget. Every renderer accepts {kind, data};
          unknown kinds resolve to UnsupportedWidgetPlaceholder via rendererFor. */}
      {Widget && turn.assistant_widget && (
        <div className="flex justify-start">
          <Widget kind={turn.assistant_widget.kind} data={widgetData} />
        </div>
      )}
    </div>
  );
}
