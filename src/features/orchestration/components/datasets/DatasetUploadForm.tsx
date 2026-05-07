import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/services/api/client';
import {
  orchestrationDatasetsApi,
  type DatasetVersionResponse,
} from '@/services/api/orchestrationDatasets';
import { notificationService } from '@/services/notifications';
import { cn } from '@/utils/cn';

type IdStrategy = 'column' | 'uuid';

interface Props {
  datasetId: string;
  onClose(): void;
  onUploaded(version: DatasetVersionResponse): void;
}

interface CsvPreview {
  headers: string[];
  /** Aligned with `headers`; first non-empty cell value per column. */
  firstValues: Array<string | null>;
}

/**
 * Lightweight client-side CSV preview parser. Reads the first ~50 lines of
 * the uploaded file so the operator can confirm headers + see one sample
 * value per column before committing to an upload. Server-side import is the
 * source of truth (handles RFC 4180 quoting, type inference, etc.) — this
 * preview is purely informational and intentionally does *not* attempt to be
 * a fully-correct CSV parser. Headers/values containing embedded commas or
 * newlines are uncommon in cohort exports and will be reflected verbatim
 * server-side regardless.
 */
function parsePreview(text: string): CsvPreview | null {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(0, 50);
  if (lines.length === 0) return null;
  const headers = lines[0].split(',').map((h) => h.trim());
  if (headers.length === 0 || headers.every((h) => !h)) return null;
  const firstValues: Array<string | null> = headers.map(() => null);
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(',');
    for (let c = 0; c < headers.length; c += 1) {
      if (firstValues[c] === null && cells[c]) {
        firstValues[c] = cells[c].trim();
      }
    }
    if (firstValues.every((v) => v !== null)) break;
  }
  return { headers, firstValues };
}

export function DatasetUploadForm({ datasetId, onClose, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [idStrategy, setIdStrategy] = useState<IdStrategy>('column');
  const [idColumn, setIdColumn] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const columnOptions = useMemo(() => {
    if (!preview) return [];
    return preview.headers.map((name, idx) => {
      const sample = preview.firstValues[idx];
      return {
        value: name,
        label: sample ? `${name}  ·  ${sample}` : name,
      };
    });
  }, [preview]);

  const handleFile = useCallback((picked: File | null) => {
    setServerError(null);
    setPreviewError(null);
    setIdColumn('');
    if (!picked) {
      setFile(null);
      setPreview(null);
      return;
    }
    if (!picked.name.toLowerCase().endsWith('.csv')) {
      setFile(null);
      setPreview(null);
      setPreviewError('File must be a CSV (.csv extension).');
      return;
    }
    setFile(picked);
    // Read just enough bytes for a sensible header preview. The server still
    // does the real parse; this is purely UX.
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const parsed = parsePreview(text);
      if (!parsed) {
        setPreview(null);
        setPreviewError('Could not detect a header row. The file may be empty.');
        return;
      }
      setPreview(parsed);
    };
    reader.onerror = () => {
      setPreview(null);
      setPreviewError('Could not read the file for preview.');
    };
    // Slice keeps the preview cheap regardless of file size.
    reader.readAsText(picked.slice(0, 64 * 1024));
  }, []);

  const canSubmit = useMemo(() => {
    if (!file || submitting) return false;
    if (idStrategy === 'uuid') return true;
    return Boolean(idColumn);
  }, [file, submitting, idStrategy, idColumn]);

  async function handleSubmit() {
    if (!file) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const version = await orchestrationDatasetsApi.uploadVersion(
        datasetId,
        file,
        idStrategy,
        idStrategy === 'column' ? idColumn : undefined,
      );
      notificationService.success(
        `Imported ${version.rowCount} rows (v${version.versionNumber}).`,
      );
      onUploaded(version);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Upload failed';
      setServerError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[var(--text-primary)]">
          CSV file
        </label>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className={cn(
            'block w-full text-sm text-[var(--text-primary)]',
            'file:mr-3 file:rounded-[var(--radius-default)] file:border file:border-[var(--border-default)]',
            'file:bg-[var(--bg-secondary)] file:px-3 file:py-1.5',
            'file:text-[13px] file:font-medium file:text-[var(--text-primary)]',
            'hover:file:bg-[var(--interactive-secondary)]',
          )}
        />
        {previewError ? (
          <p className="text-xs text-[var(--color-error)]">{previewError}</p>
        ) : null}
        {file ? (
          <p className="text-xs text-[var(--text-secondary)]">
            {file.name} · {(file.size / 1024).toFixed(1)} KB
          </p>
        ) : null}
      </div>

      {preview ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Detected columns ({preview.headers.length})
          </p>
          <ul className="max-h-48 overflow-auto rounded-[var(--radius-default)] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs">
            {preview.headers.map((h, idx) => (
              <li
                key={`${h}-${idx}`}
                className="flex items-center gap-2 py-0.5 font-mono text-[var(--text-primary)]"
              >
                <span className="min-w-[120px] shrink-0">{h}</span>
                <span className="truncate text-[var(--text-secondary)]">
                  {preview.firstValues[idx] ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-[var(--text-primary)]">
          Recipient ID strategy
        </legend>
        <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
          <input
            type="radio"
            name="id-strategy"
            value="column"
            checked={idStrategy === 'column'}
            onChange={() => setIdStrategy('column')}
            className="mt-1"
          />
          <span className="flex flex-col">
            <span>Use a column from the file</span>
            <span className="text-xs text-[var(--text-secondary)]">
              Pick a column whose values are unique per row (e.g. phone number, lead id).
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
          <input
            type="radio"
            name="id-strategy"
            value="uuid"
            checked={idStrategy === 'uuid'}
            onChange={() => setIdStrategy('uuid')}
            className="mt-1"
          />
          <span className="flex flex-col">
            <span>Auto-generate IDs (UUID per row)</span>
            <span className="text-xs text-[var(--text-secondary)]">
              The server will assign a fresh UUID to every row.
            </span>
          </span>
        </label>

        {idStrategy === 'column' ? (
          <div className="flex flex-col gap-1 pl-6">
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              ID column
            </label>
            <Select
              value={idColumn}
              onChange={(next) => setIdColumn(next)}
              options={columnOptions}
              placeholder={
                preview ? 'Select a column' : 'Pick a CSV first'
              }
              disabled={!preview || columnOptions.length === 0}
            />
          </div>
        ) : null}
      </fieldset>

      {serverError ? (
        <div className="rounded-[var(--radius-default)] border border-[var(--color-error)] bg-[var(--surface-error)] px-3 py-2 text-xs text-[var(--color-error)]">
          {serverError}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {submitting ? 'Uploading…' : 'Upload version'}
        </Button>
      </div>
    </div>
  );
}
