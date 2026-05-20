import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { useDatasetFormats } from '@/features/orchestration/queries/datasets';
import { ApiError } from '@/services/api/client';
import {
  orchestrationDatasetsApi,
  type DatasetFormatResponse,
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

interface FilePreview {
  headers: string[];
  firstValues: Array<string | null>;
}

function fileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx < 0 ? '' : name.slice(idx).toLowerCase();
}

function resolveHandler(
  formats: DatasetFormatResponse[],
  picked: File,
): DatasetFormatResponse | null {
  const ext = fileExtension(picked.name);
  if (ext) {
    const byExt = formats.find((f) => f.extensions.includes(ext));
    if (byExt) return byExt;
  }
  if (picked.type) {
    const ct = picked.type.split(';', 1)[0].trim().toLowerCase();
    const byMime = formats.find((f) => f.mimeTypes.includes(ct));
    if (byMime) return byMime;
  }
  return null;
}

function parseCsvPreview(text: string): FilePreview | null {
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

async function parseXlsxPreview(file: File): Promise<FilePreview | null> {
  const xlsx = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = xlsx.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return null;
  const sheet = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: false,
    range: 0,
  });
  if (rows.length === 0) return null;
  const header = rows[0] ?? [];
  const headers = header.map((cell) => String(cell ?? '').trim());
  if (headers.length === 0 || headers.every((h) => !h)) return null;
  const firstValues: Array<string | null> = headers.map(() => null);
  for (let i = 1; i < rows.length && i < 50; i += 1) {
    const cells = rows[i] ?? [];
    for (let c = 0; c < headers.length; c += 1) {
      if (firstValues[c] === null) {
        const v = cells[c];
        const s = v === null || v === undefined ? '' : String(v).trim();
        if (s) firstValues[c] = s;
      }
    }
    if (firstValues.every((v) => v !== null)) break;
  }
  return { headers, firstValues };
}

function parsePreviewByFormat(
  file: File,
  format: DatasetFormatResponse,
): Promise<FilePreview | null> {
  if (format.sourceType === 'csv') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? '');
        resolve(parseCsvPreview(text));
      };
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
      reader.readAsText(file.slice(0, 64 * 1024));
    });
  }
  if (format.sourceType === 'xlsx') {
    return parseXlsxPreview(file);
  }
  return Promise.resolve(null);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DatasetUploadForm({ datasetId, onClose, onUploaded }: Props) {
  const { data: formats = [], isLoading: formatsLoading } = useDatasetFormats();

  const [file, setFile] = useState<File | null>(null);
  const [pickedFormat, setPickedFormat] = useState<DatasetFormatResponse | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [idStrategy, setIdStrategy] = useState<IdStrategy>('column');
  const [idColumn, setIdColumn] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const acceptAttr = useMemo(() => {
    const exts = formats.flatMap((f) => f.extensions);
    const mimes = formats.flatMap((f) => f.mimeTypes);
    return [...exts, ...mimes].join(',');
  }, [formats]);

  const supportedLabels = useMemo(
    () => formats.map((f) => f.label).join(', '),
    [formats],
  );

  const allowedExtList = useMemo(
    () => formats.flatMap((f) => f.extensions).join(', '),
    [formats],
  );

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

  const handleFile = useCallback(
    (picked: File | null) => {
      setServerError(null);
      setPreviewError(null);
      setIdColumn('');
      setPreview(null);
      setPickedFormat(null);
      if (!picked) {
        setFile(null);
        return;
      }
      const handler = resolveHandler(formats, picked);
      if (!handler) {
        setFile(null);
        setPreviewError(
          allowedExtList
            ? `Unsupported file type. Allowed: ${allowedExtList}.`
            : 'Unsupported file type.',
        );
        return;
      }
      setFile(picked);
      setPickedFormat(handler);
      if (!handler.supportsClientPreview) {
        return;
      }
      setPreviewLoading(true);
      parsePreviewByFormat(picked, handler)
        .then((parsed) => {
          if (!parsed) {
            setPreviewError(
              'Could not detect a header row. The file may be empty.',
            );
            return;
          }
          setPreview(parsed);
        })
        .catch(() => {
          setPreviewError('Could not read the file for preview.');
        })
        .finally(() => setPreviewLoading(false));
    },
    [formats, allowedExtList],
  );

  const canSubmit = useMemo(() => {
    if (!file || !pickedFormat || submitting) return false;
    if (idStrategy === 'uuid') return true;
    return Boolean(idColumn);
  }, [file, pickedFormat, submitting, idStrategy, idColumn]);

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
          Data file
        </label>
        <input
          type="file"
          accept={acceptAttr || undefined}
          aria-label="Data file"
          disabled={formatsLoading}
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className={cn(
            'block w-full text-sm text-[var(--text-primary)]',
            'file:mr-3 file:rounded-[var(--radius-default)] file:border file:border-[var(--border-default)]',
            'file:bg-[var(--bg-secondary)] file:px-3 file:py-1.5',
            'file:text-[13px] file:font-medium file:text-[var(--text-primary)]',
            'hover:file:bg-[var(--interactive-secondary)]',
          )}
        />
        {supportedLabels ? (
          <p className="text-xs text-[var(--text-secondary)]">
            Supported: {supportedLabels}
          </p>
        ) : null}
        {previewError ? (
          <p className="text-xs text-[var(--color-error)]">{previewError}</p>
        ) : null}
        {file && pickedFormat ? (
          <p className="text-xs text-[var(--text-secondary)]">
            {file.name} · {formatBytes(file.size)} · {pickedFormat.label}
          </p>
        ) : null}
      </div>

      {previewLoading ? (
        <p className="text-xs text-[var(--text-secondary)]">Reading preview…</p>
      ) : null}

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
                preview
                  ? 'Select a column'
                  : pickedFormat && !pickedFormat.supportsClientPreview
                    ? "Server will validate after upload"
                    : 'Pick a file first'
              }
              disabled={!preview || columnOptions.length === 0}
            />
            {pickedFormat && !pickedFormat.supportsClientPreview ? (
              <p className="text-xs text-[var(--text-secondary)]">
                Column-based IDs need a header preview. Pick a file format that
                supports preview, or use auto-generated UUIDs.
              </p>
            ) : null}
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
