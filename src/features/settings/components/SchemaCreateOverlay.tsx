import { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import { Button } from '@/components/ui';
import type { SchemaDefinition } from '@/types';

interface SchemaCreateOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  promptType: 'transcription' | 'evaluation' | 'extraction';
  initialSchema?: Record<string, unknown>;
  onSave: (schema: SchemaDefinition) => void;
}

export function SchemaCreateOverlay({
  isOpen,
  onClose,
  promptType,
  initialSchema,
  onSave,
}: SchemaCreateOverlayProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [schemaText, setSchemaText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSchema) {
      setSchemaText(JSON.stringify(initialSchema, null, 2));
    }
  }, [initialSchema]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Schema name is required');
      return;
    }

    let schema: Record<string, unknown>;
    try {
      schema = JSON.parse(schemaText);
    } catch {
      setError('Invalid JSON schema');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const schemaDefinition: SchemaDefinition = {
        id: `schema-${Date.now()}`,
        name: name.trim(),
        description: description.trim(),
        promptType,
        version: 1,
        schema,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      onSave(schemaDefinition);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-[var(--bg-primary)] rounded-lg shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Create Custom Schema
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-md bg-[var(--color-error-light)] border border-[var(--color-error)]/30 p-3 text-[13px] text-[var(--color-error)]">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
              Schema Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter schema name..."
              className="w-full h-9 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the schema purpose..."
              rows={2}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-2.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none"
            />
          </div>

          {/* Schema Editor */}
          <div>
            <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
              JSON Schema
            </label>
            <textarea
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              placeholder='{"type": "object", "properties": {}}'
              rows={18}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-[12px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border-default)]">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            isLoading={isSaving}
            disabled={!name.trim() || isSaving}
          >
            <Save className="h-4 w-4" />
            Save Schema
          </Button>
        </div>
      </div>
    </div>
  );
}
