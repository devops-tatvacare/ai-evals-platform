import { Input } from '@/components/ui';
import { WizardSection, WizardStepLayout } from './WizardStepLayout';

interface RunInfoStepProps {
  name: string;
  description: string;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
  namePlaceholder?: string;
}

export function RunInfoStep({ name, description, onNameChange, onDescriptionChange, namePlaceholder }: RunInfoStepProps) {
  return (
    <WizardStepLayout
      eyebrow="Run Setup"
      title="Name the stress test"
      description="Give this run a clear label and any context your team will want when scanning results later."
    >
      <WizardSection>
        <div className="space-y-5">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[var(--text-primary)]">
              Run Name <span className="text-[var(--color-error)]">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={namePlaceholder ?? "e.g., accuracy regression check"}
              maxLength={120}
            />
            <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
              A descriptive name makes triage and comparison much easier later.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[var(--text-primary)]">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Optional notes about this run, the release it targets, or the failure mode you are probing."
              rows={4}
              maxLength={500}
              className="w-full rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-y"
            />
          </div>
        </div>
      </WizardSection>
    </WizardStepLayout>
  );
}
