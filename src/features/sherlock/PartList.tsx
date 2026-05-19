/** Render-by-type fanout over the SherlockPart discriminated union. */
import type { SherlockPart } from './generated/sherlockContract';
import {
  AssistantMarkdown,
  ChartCard,
  CompactionMarker,
  ErrorBanner,
  EvidenceRefs,
  ReasoningBlock,
  RetryPill,
  StepFinishMarker,
  StepStartMarker,
  SubagentBadge,
  ToolChip,
  UserMessage,
} from './components/parts';

interface PartListProps {
  parts: SherlockPart[];
  appId: string;
  sessionId: string | null;
  /** When true, step_start / step_finish markers render (admin trace).
   *  Defaults to false so the chat widget hides turn segmentation noise. */
  showStepMarkers?: boolean;
}

export function PartList({ parts, appId, sessionId, showStepMarkers = false }: PartListProps) {
  return (
    <div className="flex flex-col gap-2">
      {parts.map((part) => renderPart(part, { appId, sessionId, showStepMarkers }))}
    </div>
  );
}

interface RenderContext {
  appId: string;
  sessionId: string | null;
  showStepMarkers: boolean;
}

function renderPart(part: SherlockPart, ctx: RenderContext) {
  switch (part.type) {
    case 'user_message':
      return <UserMessage key={part.id} part={part} />;
    case 'subtask':
      return <SubagentBadge key={part.id} part={part} />;
    case 'tool':
      return <ToolChip key={part.id} part={part} />;
    case 'retry':
      return <RetryPill key={part.id} part={part} />;
    case 'assistant_text':
      return <AssistantMarkdown key={part.id} part={part} />;
    case 'reasoning':
      return <ReasoningBlock key={part.id} part={part} />;
    case 'chart':
      return (
        <ChartCard key={part.id} part={part} appId={ctx.appId} sessionId={ctx.sessionId} />
      );
    case 'evidence':
      return <EvidenceRefs key={part.id} part={part} />;
    case 'error':
      return <ErrorBanner key={part.id} part={part} />;
    case 'compaction':
      return <CompactionMarker key={part.id} part={part} />;
    case 'step_start':
      return ctx.showStepMarkers ? <StepStartMarker key={part.id} part={part} /> : null;
    case 'step_finish':
      return ctx.showStepMarkers ? <StepFinishMarker key={part.id} part={part} /> : null;
  }
}
