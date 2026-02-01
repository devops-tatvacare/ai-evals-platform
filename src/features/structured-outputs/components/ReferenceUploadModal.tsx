import { useState, useCallback } from 'react';
import { Upload, AlertCircle, FileJson, FileText } from 'lucide-react';
import { Modal, Button } from '@/components/ui';
import { JsonViewer } from './JsonViewer';
import { parseReferenceFile } from '@/services/structured-outputs';
import type { ParsedReference } from '@/services/structured-outputs';

interface ReferenceUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (content: object, fileName: string, fileSize: number, description?: string) => void;
  isLoading?: boolean;
}

export function ReferenceUploadModal({
  isOpen,
  onClose,
  onSubmit,
  isLoading = false,
}: ReferenceUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [parsed, setParsed] = useState<ParsedReference | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = useCallback(async (selectedFile: File | null) => {
    if (!selectedFile) {
      setFile(null);
      setParsed(null);
      return;
    }

    setFile(selectedFile);
    const result = await parseReferenceFile(selectedFile);
    setParsed(result);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      await handleFileChange(droppedFile);
    }
  }, [handleFileChange]);

  const handleSubmit = useCallback(() => {
    if (file && parsed?.isValid && parsed.content) {
      onSubmit(parsed.content, file.name, file.size, description || undefined);
      setFile(null);
      setDescription('');
      setParsed(null);
    }
  }, [file, parsed, description, onSubmit]);

  const handleClose = useCallback(() => {
    if (!isLoading) {
      setFile(null);
      setDescription('');
      setParsed(null);
      onClose();
    }
  }, [isLoading, onClose]);

  const canSubmit = file && parsed?.isValid && !isLoading;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Upload Reference Output"
      className="max-w-2xl"
    >
      <div className="space-y-4">
        {/* File upload area */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            relative rounded-lg border-2 border-dashed p-8 text-center transition-colors
            ${isDragging
              ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-accent)]/10'
              : 'border-[var(--border-default)]'
            }
            ${file ? 'bg-[var(--bg-secondary)]' : ''}
          `}
        >
          {!file ? (
            <>
              <div className="mx-auto mb-4 w-fit rounded-full bg-[var(--color-brand-accent)]/10 p-3">
                <Upload className="h-8 w-8 text-[var(--color-brand-accent)]" />
              </div>
              <h3 className="mb-2 text-sm font-medium text-[var(--text-primary)]">
                Drop your file here or click to browse
              </h3>
              <p className="mb-4 text-xs text-[var(--text-muted)]">
                Supports JSON or text files
              </p>
              <input
                type="file"
                accept=".json,.txt"
                onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </>
          ) : (
            <div className="flex items-center gap-3">
              {file.name.endsWith('.json') ? (
                <FileJson className="h-6 w-6 text-[var(--color-brand-primary)]" />
              ) : (
                <FileText className="h-6 w-6 text-[var(--color-brand-primary)]" />
              )}
              <div className="flex-1 text-left">
                <p className="text-sm font-medium text-[var(--text-primary)]">{file.name}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleFileChange(null)}
                disabled={isLoading}
              >
                Remove
              </Button>
            </div>
          )}
        </div>

        {/* Parse error */}
        {parsed && !parsed.isValid && (
          <div className="flex items-start gap-2 rounded-md border border-[var(--color-error)] bg-[var(--color-error-light)]/20 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-error)]" />
            <div>
              <p className="text-xs font-medium text-[var(--color-error)]">Invalid file format</p>
              <p className="text-xs text-[var(--text-muted)]">{parsed.error}</p>
            </div>
          </div>
        )}

        {/* Description */}
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
            placeholder="What does this reference output contain? e.g., Patient info, Prescriptions, etc."
            rows={2}
            disabled={isLoading}
            className="w-full resize-none rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-brand-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
          />
        </div>

        {/* Preview */}
        {parsed?.isValid && parsed.content && (
          <div>
            <label className="mb-2 block text-xs font-medium text-[var(--text-secondary)]">
              Preview
            </label>
            <div className="max-h-64 overflow-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3">
              <JsonViewer data={parsed.content} />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
          <Button variant="ghost" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} isLoading={isLoading}>
            Upload Reference
          </Button>
        </div>
      </div>
    </Modal>
  );
}
