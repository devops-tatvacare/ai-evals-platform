/**
 * Render-by-type fanout for a session's SherlockPart stream.
 *
 * The discriminated union is the only contract: no reconstruction, no
 * type-specific bookkeeping. Each arm gets its own placeholder component
 * (Step C swaps placeholders for the styled widget components).
 */
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
} from './components/placeholders';

interface PartListProps {
  parts: SherlockPart[];
  /** When true, step_start / step_finish markers render (admin trace).
   *  Defaults to false so the chat widget hides turn segmentation noise. */
  showStepMarkers?: boolean;
}

export function PartList({ parts, showStepMarkers = false }: PartListProps) {
  return (
    <>
      {parts.map((part) => renderPart(part, showStepMarkers))}
    </>
  );
}

function renderPart(part: SherlockPart, showStepMarkers: boolean) {
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
      return <ChartCard key={part.id} part={part} />;
    case 'evidence':
      return <EvidenceRefs key={part.id} part={part} />;
    case 'error':
      return <ErrorBanner key={part.id} part={part} />;
    case 'compaction':
      return <CompactionMarker key={part.id} part={part} />;
    case 'step_start':
      return showStepMarkers ? <StepStartMarker key={part.id} part={part} /> : null;
    case 'step_finish':
      return showStepMarkers ? <StepFinishMarker key={part.id} part={part} /> : null;
  }
}
