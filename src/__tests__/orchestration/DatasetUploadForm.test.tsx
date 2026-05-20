import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/orchestrationDatasets', () => ({
  orchestrationDatasetsApi: {
    uploadVersion: vi.fn(),
    formats: vi.fn().mockResolvedValue([
      {
        sourceType: 'csv',
        extensions: ['.csv'],
        mimeTypes: ['text/csv'],
        label: 'CSV (.csv)',
        maxUploadBytes: 50 * 1024 * 1024,
        supportsClientPreview: true,
      },
      {
        sourceType: 'xlsx',
        extensions: ['.xlsx'],
        mimeTypes: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
        label: 'Excel (.xlsx)',
        maxUploadBytes: 50 * 1024 * 1024,
        supportsClientPreview: true,
      },
    ]),
  },
}));

vi.mock('@/services/notifications', () => ({
  notificationService: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { ApiError } from '@/services/api/client';
import { orchestrationDatasetsApi } from '@/services/api/orchestrationDatasets';
import { DatasetUploadForm } from '@/features/orchestration/components/datasets/DatasetUploadForm';

function renderForm(
  overrides: Partial<React.ComponentProps<typeof DatasetUploadForm>> = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <DatasetUploadForm
        datasetId="ds-1"
        onClose={() => {}}
        onUploaded={() => {}}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

function csvFile(content: string, name = 'cohort.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

async function waitForFormats() {
  await waitFor(() =>
    expect(screen.getByText(/Supported:/)).toBeInTheDocument(),
  );
}

async function pickFile(file: File) {
  await waitForFormats();
  const input = screen.getByLabelText('Data file') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() =>
    expect(screen.getByText(/Detected columns/)).toBeInTheDocument(),
  );
}

describe('DatasetUploadForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the file picker initially', async () => {
    renderForm();
    await waitForFormats();
    expect(screen.getByLabelText('Data file')).toBeInTheDocument();
    expect(screen.getByText('Upload version')).toBeInTheDocument();
    expect(screen.getByText(/CSV.*Excel/)).toBeInTheDocument();
  });

  it('extracts headers from a selected CSV', async () => {
    renderForm();
    await pickFile(csvFile('phone,name\n+91111,Alice\n+91222,Bob\n'));

    expect(screen.getByText('phone')).toBeInTheDocument();
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('Detected columns (2)')).toBeInTheDocument();
  });

  it('disables submit until a column is chosen for column-strategy', async () => {
    renderForm();
    const submit = screen.getByRole('button', { name: /Upload version/ });
    expect(submit).toBeDisabled();

    await pickFile(csvFile('phone,name\n+91111,Alice\n'));
    expect(submit).toBeDisabled();
  });

  it('switching to UUID strategy hides the column dropdown and enables submit', async () => {
    renderForm();
    await pickFile(csvFile('phone,name\n+91111,Alice\n'));

    fireEvent.click(screen.getByLabelText(/Auto-generate IDs/));
    expect(screen.queryByText('ID column')).not.toBeInTheDocument();

    const submit = screen.getByRole('button', { name: /Upload version/ });
    expect(submit).not.toBeDisabled();
  });

  it('calls uploadVersion with the right args on submit (uuid strategy)', async () => {
    (orchestrationDatasetsApi.uploadVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'ver-1',
      datasetId: 'ds-1',
      versionNumber: 1,
      sourceType: 'csv',
      sourceFilename: 'cohort.csv',
      sourceByteSize: 100,
      rowCount: 1,
      idStrategy: 'uuid',
      idColumn: null,
      schemaDescriptor: { columns: [], rowCount: 1 },
      importedBy: 'u',
      importedAt: '2026-05-03T00:00:00Z',
    });
    const onUploaded = vi.fn();
    renderForm({ onUploaded });
    const file = csvFile('phone,name\n+91111,Alice\n');
    await pickFile(file);

    fireEvent.click(screen.getByLabelText(/Auto-generate IDs/));
    fireEvent.click(screen.getByRole('button', { name: /Upload version/ }));

    await waitFor(() =>
      expect(orchestrationDatasetsApi.uploadVersion).toHaveBeenCalledWith(
        'ds-1',
        file,
        'uuid',
        undefined,
      ),
    );
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
  });

  it('renders server-side 400 errors without clearing form state', async () => {
    (orchestrationDatasetsApi.uploadVersion as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(400, 'Invalid id_column "foo": not present in header row'),
    );
    renderForm();
    await pickFile(csvFile('phone,name\n+91111,Alice\n'));

    fireEvent.click(screen.getByLabelText(/Auto-generate IDs/));
    fireEvent.click(screen.getByRole('button', { name: /Upload version/ }));

    expect(
      await screen.findByText(/Invalid id_column "foo"/),
    ).toBeInTheDocument();
    expect(screen.getByText('Detected columns (2)')).toBeInTheDocument();
    expect(screen.getByText(/cohort\.cs/)).toBeInTheDocument();
  });

  it('rejects an unsupported file extension', async () => {
    renderForm();
    await waitForFormats();
    const input = screen.getByLabelText('Data file') as HTMLInputElement;
    const pdf = new File(['x'], 'leads.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(
      await screen.findByText(/Unsupported file type/),
    ).toBeInTheDocument();
  });
});
