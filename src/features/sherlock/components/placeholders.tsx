/**
 * Placeholder components for every SherlockPart arm.
 *
 * Step B of the Phase-2 plan: scaffold the render-by-type fanout so the
 * streamStore -> PartList chain is wireable and testable without
 * user-visible copy or final styling. Step C replaces these with the
 * styled chat-widget components once the before-after copy table is
 * approved.
 *
 * Each component renders a minimal dev-only marker carrying part.id and
 * part.type so unit tests + the in-progress chat-widget can verify
 * render-by-type without faking layouts.
 */
import type {
  AssistantTextPart,
  ChartPart,
  CompactionPart,
  ErrorPart,
  EvidencePart,
  ReasoningPart,
  RetryPart,
  StepFinishPart,
  StepStartPart,
  SubtaskPart,
  ToolPart,
  UserMessagePart,
} from '../generated/sherlockContract';

type PartOf<T> = { part: T };

export function UserMessage({ part }: PartOf<UserMessagePart>) {
  return (
    <div data-part-type="user_message" data-part-id={part.id}>
      {part.text}
    </div>
  );
}

export function SubagentBadge({ part }: PartOf<SubtaskPart>) {
  return (
    <div
      data-part-type="subtask"
      data-part-id={part.id}
      data-specialist={part.specialist}
      data-call-id={part.call_id}
    />
  );
}

export function ToolChip({ part }: PartOf<ToolPart>) {
  return (
    <div
      data-part-type="tool"
      data-part-id={part.id}
      data-call-id={part.call_id}
      data-tool={part.tool}
      data-status={part.state.status}
    />
  );
}

export function RetryPill({ part }: PartOf<RetryPart>) {
  return (
    <div
      data-part-type="retry"
      data-part-id={part.id}
      data-specialist={part.specialist}
      data-attempt={part.attempt_number}
    />
  );
}

export function AssistantMarkdown({ part }: PartOf<AssistantTextPart>) {
  return (
    <div data-part-type="assistant_text" data-part-id={part.id} data-final={part.final}>
      {part.text}
    </div>
  );
}

export function ReasoningBlock({ part }: PartOf<ReasoningPart>) {
  return (
    <div data-part-type="reasoning" data-part-id={part.id} data-final={part.final}>
      {part.text}
    </div>
  );
}

export function ChartCard({ part }: PartOf<ChartPart>) {
  return (
    <div
      data-part-type="chart"
      data-part-id={part.id}
      data-artifact-kind={part.artifact.kind}
    />
  );
}

export function EvidenceRefs({ part }: PartOf<EvidencePart>) {
  return (
    <div
      data-part-type="evidence"
      data-part-id={part.id}
      data-ref-count={(part.refs ?? []).length}
    />
  );
}

export function ErrorBanner({ part }: PartOf<ErrorPart>) {
  return (
    <div
      data-part-type="error"
      data-part-id={part.id}
      data-source={part.source}
      data-recoverable={part.recoverable}
    >
      {part.message}
    </div>
  );
}

export function CompactionMarker({ part }: PartOf<CompactionPart>) {
  return (
    <div
      data-part-type="compaction"
      data-part-id={part.id}
      data-tokens-before={part.tokens_before ?? ''}
    />
  );
}

export function StepStartMarker({ part }: PartOf<StepStartPart>) {
  return (
    <div data-part-type="step_start" data-part-id={part.id} data-turn-id={part.turn_id} />
  );
}

export function StepFinishMarker({ part }: PartOf<StepFinishPart>) {
  return (
    <div
      data-part-type="step_finish"
      data-part-id={part.id}
      data-turn-id={part.turn_id}
      data-status={part.status}
    />
  );
}
