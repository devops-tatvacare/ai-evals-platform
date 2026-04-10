import { Select } from '@/components/ui';
import { BeforeAfterChip } from './BeforeAfterChip';

interface VerdictDropdownProps {
  originalValue: string | null;
  value: string | null;
  allowedValues: string[];
  isEditing: boolean;
  isSaved?: boolean;
  color?: string;
  onChange: (nextValue: string) => void;
}

export function VerdictDropdown({
  originalValue,
  value,
  allowedValues,
  isEditing,
  isSaved = false,
  color,
  onChange,
}: VerdictDropdownProps) {
  const currentValue = value ?? originalValue ?? allowedValues[0] ?? '';
  const hasChanged = !!originalValue && !!value && originalValue !== value;

  // Show chip when not editing and value differs
  if (!isEditing && hasChanged) {
    return <BeforeAfterChip before={originalValue} after={value} category="status" />;
  }

  // Show chip + dropdown when editing and attribute is saved and value differs
  if (isEditing && isSaved && hasChanged) {
    return (
      <div className="flex min-w-[160px] flex-col items-center gap-1">
        <BeforeAfterChip before={originalValue} after={value} category="status" />
        <Select
          value={currentValue}
          onChange={onChange}
          options={allowedValues.map((allowedValue) => ({ value: allowedValue, label: allowedValue }))}
          size="sm"
          className="min-w-[140px]"
        />
      </div>
    );
  }

  if (!isEditing) {
    return (
      <span className="text-sm font-semibold leading-none" style={{ color: color || 'var(--text-primary)' }}>
        {currentValue || '—'}
      </span>
    );
  }

  return (
    <div className="flex min-w-[160px] flex-col items-center gap-1">
      {originalValue && (
        <span className="text-[10px] text-[var(--text-muted)]">
          AI: <span className="font-semibold text-[var(--text-secondary)]">{originalValue}</span>
        </span>
      )}
      <Select
        value={currentValue}
        onChange={onChange}
        options={allowedValues.map((allowedValue) => ({ value: allowedValue, label: allowedValue }))}
        size="sm"
        className="min-w-[140px]"
      />
    </div>
  );
}
