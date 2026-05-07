import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/services/api/orchestration', () => ({
  listWorkflows: vi.fn(),
  listSystemWorkflows: vi.fn(),
  cloneSystemWorkflow: vi.fn(),
  fireManualRun: vi.fn(),
  archiveWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
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
      icon: actual.PAGE_METADATA.campaigns.icon,
      title: 'Campaigns',
    }),
  };
});

import {
  archiveWorkflow,
  cloneSystemWorkflow,
  fireManualRun,
  listSystemWorkflows,
  listWorkflows,
} from '@/services/api/orchestration';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { WorkflowListPage } from '@/features/orchestration/components/WorkflowListPage';

const tenantWorkflow = {
  id: 'wf-tenant',
  tenantId: 'tenant-1',
  appId: 'inside-sales',
  workflowType: 'crm' as const,
  slug: 'tenant-campaign',
  name: 'Tenant Campaign',
  description: 'owned',
  currentPublishedVersionId: 'ver-1',
  createdBy: 'user-1',
  visibility: 'private' as const,
  sharedBy: null,
  sharedAt: null,
  createdByName: 'Test User',
  createdByEmail: 'user-1@example.com',
  createdAt: '2026-04-30T00:00:00Z',
  updatedAt: '2026-04-30T00:00:00Z',
  lastRunId: null,
  lastRunAt: null,
  lastRunStatus: null,
};

const systemWorkflow = {
  id: 'wf-system',
  tenantId: 'system',
  appId: 'inside-sales',
  workflowType: 'clinical' as const,
  slug: 'dm2-adherence-watch',
  name: 'DM2 Adherence Watch',
  description: 'seeded',
  currentPublishedVersionId: 'ver-seed',
  createdBy: 'system-user',
  visibility: 'shared' as const,
  sharedBy: 'system-user',
  sharedAt: '2026-04-30T00:00:00Z',
  createdByName: null,
  createdByEmail: null,
  createdAt: '2026-04-30T00:00:00Z',
  updatedAt: '2026-04-30T00:00:00Z',
  lastRunId: null,
  lastRunAt: null,
  lastRunStatus: null,
};

describe('WorkflowListPage', () => {
  beforeEach(() => {
    // The orchestration components read the current app id from
    // ``useCurrentAppId``; tests need to anchor it explicitly so the
    // route resolver finds the right resolver branch.
    useAppStore.setState({ currentApp: 'inside-sales' });
    useAuthStore.setState({
      user: {
        id: 'user-1',
        email: 'user-1@example.com',
        displayName: 'Test User',
        tenantId: 'tenant-1',
        tenantName: 'Tenant One',
        roleId: 'role-1',
        roleName: 'Admin',
        isOwner: true,
        permissions: ['orchestration:manage'],
        appAccess: ['inside-sales'],
      },
      accessToken: 'token',
      isAuthenticated: true,
      isLoading: false,
    });
    vi.clearAllMocks();
    (listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([tenantWorkflow]);
    (listSystemWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([systemWorkflow]);
    (cloneSystemWorkflow as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...tenantWorkflow,
      id: 'wf-cloned',
      name: 'DM2 Clone',
      slug: 'dm2-clone',
      workflowType: 'clinical',
    });
    (fireManualRun as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'run-1',
    });
    (archiveWorkflow as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('renders both tenant and system rows in a single unified table', async () => {
    render(<WorkflowListPage />);

    await waitFor(() =>
      expect(listWorkflows).toHaveBeenCalledWith({ appId: 'inside-sales', visibility: 'all' }),
    );
    expect(listSystemWorkflows).toHaveBeenCalledWith({ appId: 'inside-sales' });

    expect(await screen.findByText('Tenant Campaign')).toBeInTheDocument();
    expect(screen.getByText('DM2 Adherence Watch')).toBeInTheDocument();
    // Status column carries the Platform badge for system rows.
    expect(screen.getAllByText('Platform').length).toBeGreaterThan(0);
    // Old section headers must be gone — single unified table.
    expect(screen.queryByText('Your Workflows')).not.toBeInTheDocument();
    expect(screen.queryByText('System Starters')).not.toBeInTheDocument();
  });

  it('exposes filters via a side-panel triggered by the filter icon', async () => {
    const user = userEvent.setup();
    render(<WorkflowListPage />);

    await screen.findByText('Tenant Campaign');

    // The filter button is the only page-level affordance for filters
    // now (no inline pills). Clicking it surfaces the Source +
    // Visibility fields in a slide-over so the operator can adjust both
    // from one place. We don't drive Radix Select interactions in jsdom
    // — the underlying filter is just a `useMemo` on activeSource and
    // is exercised in production.
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    // Both filter labels live inside the slide-over `<dialog>` mounted by
    // RightSlideOverShell. `Visibility` also appears as a column header in
    // the table, so scope the assertion to the dialog instead of the
    // global screen.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Source')).toBeInTheDocument();
    expect(within(dialog).getByText('Visibility')).toBeInTheDocument();
    // Sourcing the data is unaffected by opening the panel.
    expect(listWorkflows).toHaveBeenCalledTimes(1);
    expect(listSystemWorkflows).toHaveBeenCalledTimes(1);
  });

  it('opens clone dialog and clones a system workflow', async () => {
    render(<WorkflowListPage />);

    // Row actions live behind a 3-dot popover. Find the platform row by
    // its workflow name, walk up to the surrounding `<tr>`, and click
    // the menu trigger inside it. Same pattern below for tenant rows.
    const platformRow = (await screen.findByText('DM2 Adherence Watch')).closest('tr');
    expect(platformRow).not.toBeNull();
    fireEvent.click(within(platformRow as HTMLElement).getByRole('button', { name: 'Row actions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clone' }));

    expect(screen.getByText('Clone System Workflow')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Display Name'), {
      target: { value: 'DM2 Clone' },
    });
    fireEvent.change(screen.getByLabelText('Slug (stable id)'), {
      target: { value: 'dm2-clone' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Clone' }).at(-1)!);

    await waitFor(() =>
      expect(cloneSystemWorkflow).toHaveBeenCalledWith({
        sourceWorkflowId: 'wf-system',
        newSlug: 'dm2-clone',
        newName: 'DM2 Clone',
        targetAppId: 'inside-sales',
      }),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/inside-sales/orchestration/workflows/wf-cloned'),
    );
  });

  it('runs a published custom workflow from the unified table', async () => {
    render(<WorkflowListPage />);

    const tenantRow = (await screen.findByText('Tenant Campaign')).closest('tr');
    expect(tenantRow).not.toBeNull();
    fireEvent.click(within(tenantRow as HTMLElement).getByRole('button', { name: 'Row actions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));

    await waitFor(() => expect(fireManualRun).toHaveBeenCalledWith('wf-tenant'));
    // Phase-14 follow-up — Run Now from the listing now navigates to the
    // builder with `?run=<id>` (unified inspector overlay) instead of the
    // legacy standalone /runs/:runId page.
    expect(mockNavigate).toHaveBeenCalledWith(
      '/inside-sales/orchestration/workflows/wf-tenant?run=run-1',
    );
  });

  it('archives a custom workflow from the unified table', async () => {
    render(<WorkflowListPage />);

    const tenantRow = (await screen.findByText('Tenant Campaign')).closest('tr');
    expect(tenantRow).not.toBeNull();
    fireEvent.click(within(tenantRow as HTMLElement).getByRole('button', { name: 'Row actions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    // Confirm dialog renders its own Archive button — it's the last
    // button with that name once the menu has closed.
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' }).at(-1)!);

    await waitFor(() => expect(archiveWorkflow).toHaveBeenCalledWith('wf-tenant'));
  });
});
