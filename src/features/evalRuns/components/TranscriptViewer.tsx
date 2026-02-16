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
    <span className="inline-block px-1.5 py-px rounded text-[0.62rem] font-semibold bg-violet-500 text-white align-middle ml-1">
      IMG
    </span>
  );
}

/** Adversarial transcript viewer (TranscriptTurn[]) */
export default function TranscriptViewer({ turns }: TranscriptProps) {
  return (
    <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto py-2 px-3 bg-slate-50/60 rounded-lg border border-slate-100">
      {turns.map((t) => (
        <div key={t.turn_number} className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[0.65rem] text-slate-400 font-medium">
            <span>Turn {t.turn_number}</span>
            {t.detected_intent && (
              <span className="text-indigo-400 font-normal">
                {t.detected_intent}
              </span>
            )}
          </div>
          <div className="flex justify-start">
            <div className="bg-slate-200/80 rounded-xl rounded-bl-sm px-3 py-1.5 max-w-[85%] text-[0.8rem] leading-relaxed whitespace-pre-wrap break-words text-slate-800">
              {t.user_message}
            </div>
          </div>
          <div className="flex justify-end">
            <div className="bg-blue-50 border border-blue-100 rounded-xl rounded-br-sm px-3 py-1.5 max-w-[85%] text-[0.8rem] leading-relaxed whitespace-pre-wrap break-words text-slate-700">
              {t.bot_response}
            </div>
          </div>
        </div>
      ))}
      {turns.length === 0 && (
        <p className="text-xs text-slate-400 text-center py-3">
          No transcript available
        </p>
      )}
    </div>
  );
}

/** Chat message viewer (ChatMessage[] from thread evaluations) */
export function ChatViewer({ messages }: ChatProps) {
  return (
    <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto py-2 px-3 bg-slate-50/60 rounded-lg border border-slate-100">
      {messages.map((m, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[0.65rem] text-slate-400 font-medium">
            <span>Turn {i + 1}</span>
            {m.timestamp && (
              <span className="font-normal">{formatChatTimestamp(m.timestamp)}</span>
            )}
            {m.intent_detected && (
              <span className="text-indigo-400 font-normal">
                {m.intent_detected}
              </span>
            )}
            {m.has_image && <ImgBadge />}
          </div>
          <div className="flex justify-start">
            <div className="bg-slate-200/80 rounded-xl rounded-bl-sm px-3 py-1.5 max-w-[85%] text-[0.8rem] leading-relaxed whitespace-pre-wrap break-words text-slate-800">
              {m.query_text}
            </div>
          </div>
          <div className="flex justify-end">
            <div className="bg-blue-50 border border-blue-100 rounded-xl rounded-br-sm px-3 py-1.5 max-w-[85%] text-[0.8rem] leading-relaxed whitespace-pre-wrap break-words text-slate-700">
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
    <div className="text-[0.78rem] max-h-[280px] overflow-y-auto">
      {messages.map((m, i) => (
        <div key={i} className="py-1 border-b border-slate-100 last:border-b-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[0.72rem] text-slate-600">
              Turn {i + 1}
            </span>
            {m.timestamp && (
              <span className="text-[0.66rem] text-slate-400">
                {formatChatTimestamp(m.timestamp)}
              </span>
            )}
            {m.has_image && <ImgBadge />}
          </div>
          <div className="mt-0.5">
            <span className="font-semibold text-[0.72rem] text-blue-600">User:</span>
            <span className="text-slate-500 ml-1">{m.query_text}</span>
          </div>
          <div>
            <span className="font-semibold text-[0.72rem] text-green-600">Bot:</span>
            <span className="text-slate-500 ml-1">
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
