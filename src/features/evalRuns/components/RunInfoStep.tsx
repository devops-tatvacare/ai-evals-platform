import { Input } from '@/components/ui';

interface RunInfoStepProps {
  name: string;
  description: string;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
}

export function RunInfoStep({ name, description, onNameChange, onDescriptionChange }: RunInfoStepProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
          Run Name <span className="text-[var(--color-error)]">*</span>
        </label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g., Weekly batch evaluation"
          maxLength={120}
        />
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          A descriptive name to identify this run later.
        </p>
      </div>

      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Optional notes about this evaluation run..."
          rows={3}
          maxLength={500}
          className="w-full rounded-[6px] border bg-[var(--bg-primary)] px-3 py-2 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors border-[var(--border-default)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none"
        />
      </div>
    </div>
  );
}
