/**
 * TranscriptionConfigStep — wizard step 3 for inside-sales eval wizard.
 * Configures language, script, model, and transcription toggles.
 */

import { Info } from 'lucide-react';
import { SingleSelect } from '@/components/ui';
import type { SingleSelectOption } from '@/components/ui';

const LANGUAGE_OPTIONS: SingleSelectOption[] = [
  { value: 'hi', label: 'Hindi' },
  { value: 'en', label: 'English' },
  { value: 'hi-en', label: 'Hindi-English (Mixed)' },
  { value: 'auto', label: 'Auto-detect' },
];

const SCRIPT_OPTIONS: SingleSelectOption[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'devanagari', label: 'Devanagari' },
  { value: 'latin', label: 'Latin (Romanized)' },
];

const MODEL_OPTIONS: SingleSelectOption[] = [
  { value: 'gemini', label: 'Gemini (default)' },
  { value: 'whisper', label: 'Whisper' },
];

export interface TranscriptionConfig {
  language: string;
  script: string;
  model: string;
  forceRetranscribe: boolean;
  preserveCodeSwitching: boolean;
  speakerDiarization: boolean;
}

interface TranscriptionConfigStepProps {
  config: TranscriptionConfig;
  onChange: (updates: Partial<TranscriptionConfig>) => void;
  totalCalls: number;
}

export function TranscriptionConfigStep({
  config,
  onChange,
  totalCalls,
}: TranscriptionConfigStepProps) {
  return (
    <div className="space-y-5">
      {/* Info callout */}
      <div className="flex items-start gap-2.5 rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2.5">
        <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
        <p className="text-xs text-[var(--text-secondary)]">
          Calls without transcripts will be transcribed before evaluation. Configure transcription settings below.
        </p>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-xs">
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
          <div className="text-[10px] font-medium text-[var(--text-muted)] uppercase">Total Calls</div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">{totalCalls}</div>
        </div>
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
          <div className="text-[10px] font-medium text-[var(--text-muted)] uppercase">Need Transcription</div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">{totalCalls}</div>
        </div>
      </div>

      {/* Language */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--text-secondary)]">Language</label>
        <SingleSelect
          value={config.language}
          onChange={(language) => onChange({ language })}
          options={LANGUAGE_OPTIONS}
          size="sm"
        />
      </div>

      {/* Source Script */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--text-secondary)]">Source Script</label>
        <SingleSelect
          value={config.script}
          onChange={(script) => onChange({ script })}
          options={SCRIPT_OPTIONS}
          size="sm"
        />
      </div>

      {/* Transcription Model */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--text-secondary)]">Transcription Model</label>
        <SingleSelect
          value={config.model}
          onChange={(model) => onChange({ model })}
          options={MODEL_OPTIONS}
          size="sm"
        />
      </div>

      {/* Toggles */}
      <div className="space-y-2.5">
        <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={config.forceRetranscribe}
            onChange={(e) => onChange({ forceRetranscribe: e.target.checked })}
            className="h-3.5 w-3.5 rounded accent-[var(--color-brand-accent)]"
          />
          Force re-transcription (even if transcript exists)
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={config.preserveCodeSwitching}
            onChange={(e) => onChange({ preserveCodeSwitching: e.target.checked })}
            className="h-3.5 w-3.5 rounded accent-[var(--color-brand-accent)]"
          />
          Preserve code-switching (Hindi ↔ English)
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={config.speakerDiarization}
            onChange={(e) => onChange({ speakerDiarization: e.target.checked })}
            className="h-3.5 w-3.5 rounded accent-[var(--color-brand-accent)]"
          />
          Speaker diarization (identify agent vs lead)
        </label>
      </div>
    </div>
  );
}
