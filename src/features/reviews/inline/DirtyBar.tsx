import { Button } from '@/components/ui';
import { Save, SendHorizontal, Trash2 } from 'lucide-react';

interface DirtyBarProps {
  changeCount: number;
  changeSummary?: string;
  saving?: boolean;
  onDiscard: () => void;
  onSaveDraft: () => void;
  onFinalize: () => void;
}

export function DirtyBar({ changeCount, changeSummary, saving = false, onDiscard, onSaveDraft, onFinalize }: DirtyBarProps) {
  if (changeCount === 0) return null;

  return (
    <div className="flex items-center justify-between px-5 py-2 border-t border-[var(--interactive-primary)]/30 bg-gradient-to-r from-[color-mix(in_srgb,var(--interactive-primary)_10%,transparent)] to-transparent">
      <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-brand)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-brand)] animate-pulse" />
        {changeCount} unsaved {changeCount === 1 ? 'change' : 'changes'}
        {changeSummary && (
          <span className="text-[11px] opacity-70">&mdash; {changeSummary}</span>
        )}
      </div>
      <div className="flex gap-1.5">
        <Button variant="ghost" size="sm" icon={Trash2} iconOnly onClick={onDiscard} disabled={saving} aria-label="Discard draft" title="Discard" />
        <Button variant="secondary" size="sm" icon={Save} iconOnly onClick={onSaveDraft} isLoading={saving} aria-label="Save draft" title="Save Draft" />
        <Button size="sm" icon={SendHorizontal} iconOnly onClick={onFinalize} isLoading={saving} aria-label="Finalize review" title="Finalize" />
      </div>
    </div>
  );
}
