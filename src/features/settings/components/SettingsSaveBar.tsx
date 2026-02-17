import { Save, X } from 'lucide-react';
import { Button } from '@/components/ui';

export function SettingsSaveBar({
  isDirty,
  isSaving,
  onSave,
  onDiscard,
}: {
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!isDirty) return null;

  return (
    <div className="fixed bottom-6 right-6 z-30 flex gap-3">
      <Button
        variant="secondary"
        onClick={onDiscard}
        className="shadow-lg gap-2"
      >
        <X className="h-4 w-4" />
        Discard
      </Button>
      <Button
        onClick={onSave}
        isLoading={isSaving}
        className="shadow-lg gap-2"
      >
        <Save className="h-4 w-4" />
        Save Changes
      </Button>
    </div>
  );
}
