import type { TranscriptTurn, ChatMessage } from "@/types";
import { formatChatTimestamp } from "@/utils/evalFormatters";

interface TranscriptProps {
  turns: TranscriptTurn[];
}

interface ChatProps {
  messages: ChatMessage[];
}

function ImgBadge() {
  return (
    <span className="inline-block px-1.5 py-px rounded text-[var(--text-xs)] font-semibold bg-[var(--color-accent-purple)] text-white align-middle ml-1">
      IMG
    </span>
  );
}

/** Adversarial transcript viewer (TranscriptTurn[]) */
export default function TranscriptViewer({ turns }: TranscriptProps) {
  return (
    <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto py-2 px-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)]">
      {turns.map((t) => (
        <div key={t.turn_number} className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[var(--text-xs)] text-[var(--text-muted)] font-medium">
            <span>Turn {t.turn_number}</span>
            {t.detected_intent && (
              <span className="text-[var(--color-info)] font-normal">
                {t.detected_intent}
              </span>
            )}
          </div>
          <div className="flex justify-start">
            <div className="bg-[var(--bg-tertiary)] rounded-xl rounded-bl-sm px-3 py-1.5 max-w-[85%] text-[0.8rem] leading-relaxed whitespace-pre-wrap break-words text-[var(--text-primary)]">
              {t.user_message}
            </div>
          </div>
          <div className="flex justify-end">
            <div className="bg-[var(--surface-info)] border border-[var(--border-info)] rounded-xl rounded-br-sm px-3 py-1.5 max-w-[85%] text-[0.8rem] leading-relaxed whitespace-pre-wrap break-words text-[var(--text-primary)]">
              {t.bot_response}
            </div>
          </div>
        </div>
      ))}
      {turns.length === 0 && (
        <p className="text-xs text-[var(--text-muted)] text-center py-3">
          No transcript available
        </p>
      )}
    </div>
  );
}

/** Chat message viewer (ChatMessage[] from thread evaluations) */
export function ChatViewer({ messages }: ChatProps) {
  return (
    <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto py-2 px-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)]">
      {messages.map((m, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[var(--text-xs)] text-[var(--text-muted)] font-medium">
            <span>Turn {i + 1}</span>
            {m.timestamp && (
              <span className="font-normal">{formatChatTimestamp(m.timestamp)}</span>
            )}
            {m.intent_detected && (
              <span className="text-[var(--color-info)] font-normal">
                {m.intent_detected}
              </span>
            )}
            {m.has_image && <ImgBadge />}
          </div>
          <div className="flex justify-start">
            <div className="bg-[var(--bg-tertiary)] rounded-xl rounded-bl-sm px-3 py-1.5 max-w-[85%] text-[0.8rem] leading-relaxed whitespace-pre-wrap break-words text-[var(--text-primary)]">
              {m.query_text}
            </div>
          </div>
          <div className="flex justify-end">
            <div className="bg-[var(--surface-info)] border border-[var(--border-info)] rounded-xl rounded-br-sm px-3 py-1.5 max-w-[85%] text-[0.8rem] leading-relaxed whitespace-pre-wrap break-words text-[var(--text-primary)]">
              {m.final_response_message}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Compact transcript for table expanded rows — matches HTML report style */
export function CompactTranscript({ messages }: ChatProps) {
  return (
    <div className="text-[var(--text-sm)] max-h-[280px] overflow-y-auto">
      {messages.map((m, i) => (
        <div key={i} className="py-1 border-b border-[var(--border-subtle)] last:border-b-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[var(--text-xs)] text-[var(--text-secondary)]">
              Turn {i + 1}
            </span>
            {m.timestamp && (
              <span className="text-[var(--text-xs)] text-[var(--text-muted)]">
                {formatChatTimestamp(m.timestamp)}
              </span>
            )}
            {m.has_image && <ImgBadge />}
          </div>
          <div className="mt-0.5">
            <span className="font-semibold text-[var(--text-xs)] text-[var(--color-info)]">User:</span>
            <span className="text-[var(--text-secondary)] ml-1">{m.query_text}</span>
          </div>
          <div>
            <span className="font-semibold text-[var(--text-xs)] text-[var(--color-success)]">Bot:</span>
            <span className="text-[var(--text-secondary)] ml-1">
              {m.final_response_message.length > 400
                ? m.final_response_message.slice(0, 400) + "..."
                : m.final_response_message}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
