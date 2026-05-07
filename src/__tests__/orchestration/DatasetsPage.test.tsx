import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/services/api/orchestrationDatasets', () => ({
  orchestrationDatasetsApi: {
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
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

vi.mock('@/config/pageMetadata', async () => {
  const actual = await vi.importActual<typeof import('@/config/pageMetadata')>(
    '@/config/pageMetadata',
  );
  return {
    ...actual,
    usePageMetadata: () => ({
      icon: actual.PAGE_METADATA.datasets.icon,
      title: 'Cohort Datasets',
    }),
  };
});

import { ApiError } from '@/services/api/client';
import { orchestrationDatasetsApi } from '@/services/api/orchestrationDatasets';
import { notificationService } from '@/services/notifications';
import { useAppStore } from '@/stores/appStore';
import { DatasetsPage } from '@/features/orchestration/components/datasets/DatasetsPage';

function makeDataset(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ds-1',
    tenantId: 't',
    appId: 'inside-sales',
    name: 'DM2 Pilot',
    description: null,
    createdBy: 'u',
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    latestVersion: {
      id: 'ver-1',
      datasetId: 'ds-1',
      versionNumber: 2,
      sourceType: 'csv' as const,
      sourceFilename: 'cohort.csv',
      sourceByteSize: 100,
      rowCount: 250,
      idStrategy: 'column' as const,
      idColumn: 'phone',
      schemaDescriptor: { columns: [], rowCount: 250 },
      importedBy: 'u',
      importedAt: '2026-05-02T00:00:00Z',
    },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DatasetsPage />
    </MemoryRouter>,
  );
}

describe('DatasetsPage', () => {
  beforeEach(() => {
    useAppStore.setState({ currentApp: 'inside-sales' });
    vi.clearAllMocks();
  });

  it('renders the empty state when no datasets exist', async () => {
    (orchestrationDatasetsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPage();

    await waitFor(() =>
      expect(orchestrationDatasetsApi.list).toHaveBeenCalledWith('inside-sales'),
    );
    expect(await screen.findByText('No datasets yet')).toBeInTheDocument();
  });

  it('renders one row per dataset returned by the API', async () => {
    (orchestrationDatasetsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDataset({ id: 'a', name: 'Alpha cohort' }),
      makeDataset({ id: 'b', name: 'Beta cohort' }),
    ]);
    renderPage();

    expect(await screen.findByText('Alpha cohort')).toBeInTheDocument();
    expect(screen.getByText('Beta cohort')).toBeInTheDocument();
    // Latest version rendered for each row.
    expect(screen.getAllByText('v2').length).toBe(2);
  });

  it('opens the create dialog and submits via the API', async () => {
    (orchestrationDatasetsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (orchestrationDatasetsApi.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeDataset({ id: 'created-1', name: 'New cohort' }),
    );
    renderPage();

    await waitFor(() =>
      expect(orchestrationDatasetsApi.list).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByRole('button', { name: /New Dataset/ }));
    expect(await screen.findByText('New cohort dataset')).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText(/DM2 Adherence Pilot/);
    fireEvent.change(nameInput, { target: { value: 'New cohort' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));

    await waitFor(() =>
      expect(orchestrationDatasetsApi.create).toHaveBeenCalledWith({
        appId: 'inside-sales',
        name: 'New cohort',
        description: null,
      }),
    );
    // After create, navigates to the new detail page.
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        '/inside-sales/orchestration/datasets/created-1',
      ),
    );
  });

  it('confirms and calls remove when deleting a dataset', async () => {
    (orchestrationDatasetsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDataset(),
    ]);
    (orchestrationDatasetsApi.remove as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    renderPage();

    // Row-action "Delete" opens the ConfirmDialog. Once open, two buttons
    // labelled "Delete" are present (the row trigger + the dialog confirm)
    // — the dialog confirm is rendered last in the DOM.
    fireEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));
    const buttons = await screen.findAllByRole('button', { name: /^Delete$/ });
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() =>
      expect(orchestrationDatasetsApi.remove).toHaveBeenCalledWith('ds-1'),
    );
  });

  it('renders the workflow-binding error toast when delete returns 409', async () => {
    (orchestrationDatasetsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDataset(),
    ]);
    (orchestrationDatasetsApi.remove as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(
        409,
        'Dataset is bound to workflows: dm2-adherence-watch, mql-concierge',
      ),
    );
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));
    const buttons = await screen.findAllByRole('button', { name: /^Delete$/ });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() =>
      expect(notificationService.error).toHaveBeenCalledWith(
        expect.stringContaining('dm2-adherence-watch'),
      ),
    );
  });
});
