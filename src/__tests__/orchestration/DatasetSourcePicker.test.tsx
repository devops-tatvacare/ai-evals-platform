import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/orchestration', () => ({
  fetchCohortSources: vi.fn(),
}));

import { fetchCohortSources } from '@/services/api/orchestration';
import type { CohortColumnType, CohortSource } from '@/features/orchestration/types';
import { useAppStore } from '@/stores/appStore';
import { DatasetSourcePicker } from '@/features/orchestration/components/datasets/DatasetSourcePicker';
import { SourceSelector } from '@/features/orchestration/components/editors/SourceSelector';
import { normalizeFilterValueForOperator } from '@/features/orchestration/components/editors/sourceSelectorValueUtils';

function makeStatic(overrides: Partial<CohortSource> = {}): CohortSource {
  return {
    sourceRef: 'crm.lead_record',
    displayLabel: 'CRM Leads',
    description: 'Engineering-owned CRM lead records.',
    kind: 'static',
    workflowTypes: ['crm'],
    appIds: ['inside-sales'],
    idColumn: 'lead_id',
    allowedPayloadColumns: ['name', 'phone', 'stage'],
    allowedFilterColumns: ['stage', 'created_at'],
    allowedLookbackColumns: ['created_at'],
    ...overrides,
  };
}

function makeDataset(overrides: Partial<CohortSource> = {}): CohortSource {
  return {
    sourceRef: 'dataset.aaaa-bbbb-cccc',
    displayLabel: 'DM2 Pilot (v3)',
    description: 'Uploaded dataset version (4 columns).',
    kind: 'dataset',
    workflowTypes: ['crm', 'clinical'],
    appIds: ['inside-sales'],
    idColumn: 'recipient_id',
    allowedPayloadColumns: ['recipient_id', 'name', 'phone', 'enrolled_at'],
    allowedFilterColumns: ['recipient_id', 'name', 'phone', 'enrolled_at'],
    allowedLookbackColumns: ['enrolled_at'],
    schemaDescriptor: {
      columns: [
        { name: 'recipient_id', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'phone', type: 'string' },
        { name: 'enrolled_at', type: 'datetime' },
      ],
      rowCount: 100,
    },
    ...overrides,
  };
}

describe('DatasetSourcePicker', () => {
  beforeEach(() => {
    useAppStore.setState({ currentApp: 'inside-sales' });
    vi.clearAllMocks();
  });

  function renderPicker(props: Partial<React.ComponentProps<typeof DatasetSourcePicker>> = {}) {
    const onChange = vi.fn();
    return {
      onChange,
      ...render(
        <MemoryRouter>
          <DatasetSourcePicker
            appId='inside-sales'
            workflowType='crm'
            value={null}
            {...props}
            onChange={onChange}
          />
        </MemoryRouter>,
      ),
    };
  }

  it('renders both groups when the API returns mixed entries', async () => {
    (fetchCohortSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeStatic(),
      makeDataset(),
    ]);
    renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: /Pick a source/ }));

    expect(await screen.findByText('CRM Leads')).toBeInTheDocument();
    expect(await screen.findByText('DM2 Pilot (v3)')).toBeInTheDocument();
    // Group labels ride in the option ``meta`` slot.
    expect(screen.getByText('Built-in')).toBeInTheDocument();
    expect(screen.getByText('Dataset')).toBeInTheDocument();
  });

  it('forwards the dataset source_ref AND entry to onChange', async () => {
    (fetchCohortSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeStatic(),
      makeDataset(),
    ]);
    const { onChange } = renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: /Pick a source/ }));
    fireEvent.click(await screen.findByText('DM2 Pilot (v3)'));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const [ref, entry] = onChange.mock.calls[0];
    expect(ref).toBe('dataset.aaaa-bbbb-cccc');
    expect(entry.kind).toBe('dataset');
    expect(entry.sourceRef).toBe('dataset.aaaa-bbbb-cccc');
  });

  it('forwards the static source_ref AND entry to onChange', async () => {
    (fetchCohortSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeStatic(),
      makeDataset(),
    ]);
    const { onChange } = renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: /Pick a source/ }));
    fireEvent.click(await screen.findByText('CRM Leads'));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const [ref, entry] = onChange.mock.calls[0];
    expect(ref).toBe('crm.lead_record');
    expect(entry.kind).toBe('static');
  });

  it('renders the dataset affordance card when a dataset is selected', async () => {
    const ds = makeDataset();
    (fetchCohortSources as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeStatic(),
      ds,
    ]);
    renderPicker({ value: ds.sourceRef });

    // Wait for the affordance card — the dataset's columns surface here.
    expect(
      await screen.findByText(`${ds.allowedFilterColumns.length} columns detected`),
    ).toBeInTheDocument();
    // Column names appear in the preview row.
    expect(
      screen.getByText(ds.allowedFilterColumns.slice(0, 5).join(', ')),
    ).toBeInTheDocument();
    // The "View datasets" link routes to the per-app datasets index.
    const link = screen.getByText('View datasets').closest('a');
    expect(link).toHaveAttribute('href', '/inside-sales/orchestration/datasets');
  });

  it('renders a loading placeholder before the fetch resolves', () => {
    (fetchCohortSources as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {
        /* never resolves */
      }),
    );
    renderPicker();
    expect(
      screen.getByRole('button', { name: /Loading sources/ }),
    ).toBeInTheDocument();
  });

  it('renders an empty-state link when the API returns no entries', async () => {
    (fetchCohortSources as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPicker();
    expect(
      await screen.findByText('Create a dataset to get started.'),
    ).toBeInTheDocument();
  });

  it('shows a retry control when the catalog fetch fails', async () => {
    const fetchMock = fetchCohortSources as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    renderPicker();

    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce([makeStatic()]);
    fireEvent.click(screen.getByText('Retry'));
    fireEvent.click(await screen.findByRole('button', { name: /Pick a source/ }));
    expect(await screen.findByText('CRM Leads')).toBeInTheDocument();
  });
});

describe('SourceSelector dataset filters', () => {
  beforeEach(() => {
    useAppStore.setState({ currentApp: 'inside-sales' });
    vi.clearAllMocks();
  });

  it('renders a filter editor driven by the selected dataset source', async () => {
    const ds = makeDataset({
      allowedFilterColumns: ['mql_score', 'city'],
      allowedPayloadColumns: ['mql_score', 'city'],
      schemaDescriptor: {
        columns: [
          { name: 'mql_score', type: 'integer' },
          { name: 'city', type: 'string' },
        ],
        rowCount: 3,
      },
    });
    (fetchCohortSources as ReturnType<typeof vi.fn>).mockResolvedValue([ds]);
    const onChange = vi.fn();

    render(
      <MemoryRouter>
        <SourceSelector
          appId='inside-sales'
          workflowType='crm'
          value={{ source_ref: ds.sourceRef }}
          onChange={onChange}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: [
            expect.objectContaining({
              column: 'mql_score',
              op: 'gte',
              value: 0,
            }),
          ],
        }),
      ),
    );
  });

  it('renders filters and lookback controls inside dedicated inspector sections', async () => {
    const ds = makeDataset();
    (fetchCohortSources as ReturnType<typeof vi.fn>).mockResolvedValue([ds]);

    render(
      <MemoryRouter>
        <SourceSelector
          appId='inside-sales'
          workflowType='crm'
          value={{ source_ref: ds.sourceRef, filters: [], payload_fields: ['name'] }}
          onChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Payload fields')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /name/ })).toBeInTheDocument();
    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('Lookback window')).toBeInTheDocument();
  });

  it('uses a multi-select combobox instead of payload chips', async () => {
    const ds = makeDataset();
    (fetchCohortSources as ReturnType<typeof vi.fn>).mockResolvedValue([ds]);
    const onChange = vi.fn();

    render(
      <MemoryRouter>
        <SourceSelector
          appId='inside-sales'
          workflowType='crm'
          value={{ source_ref: ds.sourceRef, payload_fields: [] }}
          onChange={onChange}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Select payload fields/ }));
    fireEvent.click(await screen.findByText('phone'));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ payload_fields: ['phone'] }),
    );
  });

  it('renders list-style filter values for in/not_in operators', async () => {
    const ds = makeDataset({
      allowedFilterColumns: ['city'],
      allowedPayloadColumns: ['city'],
      schemaDescriptor: {
        columns: [{ name: 'city', type: 'string' }],
        rowCount: 3,
      },
    });
    (fetchCohortSources as ReturnType<typeof vi.fn>).mockResolvedValue([ds]);

    render(
      <MemoryRouter>
        <SourceSelector
          appId='inside-sales'
          workflowType='crm'
          value={{
            source_ref: ds.sourceRef,
            filters: [{ column: 'city', op: 'in', value: ['Mumbai', 'Delhi'] }],
          }}
          onChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue('Mumbai, Delhi')).toBeInTheDocument();
  });

  it('preserves typed commas while editing list operators', async () => {
    const ds = makeDataset({
      allowedFilterColumns: ['city'],
      allowedPayloadColumns: ['city'],
      schemaDescriptor: {
        columns: [{ name: 'city', type: 'string' }],
        rowCount: 3,
      },
    });
    (fetchCohortSources as ReturnType<typeof vi.fn>).mockResolvedValue([ds]);

    function Harness() {
      const [value, setValue] = useState({
        source_ref: ds.sourceRef,
        filters: [{ column: 'city', op: 'in', value: ['Mumbai'] }],
      });

      return (
        <MemoryRouter>
          <SourceSelector
            appId='inside-sales'
            workflowType='crm'
            value={value}
            onChange={setValue}
          />
        </MemoryRouter>
      );
    }

    render(<Harness />);

    const input = await screen.findByDisplayValue('Mumbai');
    fireEvent.change(input, { target: { value: 'Mumbai,' } });

    expect(screen.getByDisplayValue('Mumbai,')).toBeInTheDocument();
  });

  it('normalizes scalar values when switching to list operators', () => {
    const fallback = (type: CohortColumnType) => {
      if (type === 'integer' || type === 'number') return 0;
      if (type === 'boolean') return true;
      return '';
    };

    expect(normalizeFilterValueForOperator('Mumbai', 'string', 'in', fallback)).toEqual(['Mumbai']);
    expect(normalizeFilterValueForOperator(42, 'integer', 'in', fallback)).toEqual([42]);
    expect(normalizeFilterValueForOperator(['Mumbai', 'Delhi'], 'string', 'eq', fallback)).toBe('Mumbai');
  });
});
