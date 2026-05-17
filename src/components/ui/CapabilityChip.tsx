import {
  Braces,
  Brain,
  FileText,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Type,
  Video,
  Volume2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import { Tooltip } from '@/components/ui/Tooltip';
import type { CapabilityTag } from '@/services/api/llmModelsApi';
import { cn } from '@/utils';

const ICON_MAP: Record<CapabilityTag, LucideIcon> = {
  text_input: Type,
  text_output: Type,
  image_input: ImageIcon,
  audio_input: Mic,
  audio_output: Volume2,
  video_input: Video,
  pdf_input: FileText,
  reasoning: Brain,
  tool_call: Wrench,
  structured_output: Braces,
  attachment: Paperclip,
};

const LABEL_MAP: Record<CapabilityTag, string> = {
  text_input: 'Text input',
  text_output: 'Text output',
  image_input: 'Image input (vision)',
  audio_input: 'Audio input (transcription)',
  audio_output: 'Audio output (TTS)',
  video_input: 'Video input',
  pdf_input: 'PDF input',
  reasoning: 'Reasoning',
  tool_call: 'Tool calls',
  structured_output: 'Structured output',
  attachment: 'File attachments',
};

interface CapabilityChipsProps {
  tags: CapabilityTag[];
  className?: string;
}

/**
 * Capability badges rendered alongside a model option. Icon-only so the chip
 * row stays narrow; each chip carries a tooltip with the readable label.
 * Text_input + text_output dedupe to a single "text" chip — every model on
 * the catalog handles both, so showing two identical icons is noise.
 */
export function CapabilityChips({ tags, className }: CapabilityChipsProps) {
  const dedup: CapabilityTag[] = [];
  const seen = new Set<CapabilityTag>();
  const hasText = tags.includes('text_input') || tags.includes('text_output');
  if (hasText) {
    dedup.push('text_input');
    seen.add('text_input');
    seen.add('text_output');
  }
  for (const tag of tags) {
    if (seen.has(tag)) continue;
    dedup.push(tag);
    seen.add(tag);
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 align-middle',
        className,
      )}
      role="list"
      aria-label="Model capabilities"
    >
      {dedup.map((tag) => (
        <CapabilityChip key={tag} tag={tag} />
      ))}
    </span>
  );
}

interface CapabilityChipProps {
  tag: CapabilityTag;
}

function CapabilityChip({ tag }: CapabilityChipProps) {
  const Icon = ICON_MAP[tag];
  return (
    <Tooltip content={LABEL_MAP[tag]}>
      <span
        role="listitem"
        aria-label={LABEL_MAP[tag]}
        className={cn(
          'inline-flex h-5 w-5 items-center justify-center rounded',
          'border border-[var(--border-subtle)] bg-[var(--bg-secondary)]',
          'text-[var(--text-muted)]',
        )}
      >
        <Icon className="h-3 w-3" aria-hidden />
      </span>
    </Tooltip>
  );
}
