import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('renders both tenant and system rows in a single unified table with Source badges', async () => {
    render(<WorkflowListPage />);

    await waitFor(() =>
      expect(listWorkflows).toHaveBeenCalledWith({ appId: 'inside-sales', visibility: 'all' }),
    );
    expect(listSystemWorkflows).toHaveBeenCalledWith({ appId: 'inside-sales' });

    expect(await screen.findByText('Tenant Campaign')).toBeInTheDocument();
    expect(screen.getByText('DM2 Adherence Watch')).toBeInTheDocument();
    expect(screen.getAllByText('Custom').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Platform').length).toBeGreaterThan(0);
    // Old section headers must be gone — single unified table.
    expect(screen.queryByText('Your Workflows')).not.toBeInTheDocument();
    expect(screen.queryByText('System Starters')).not.toBeInTheDocument();
  });

  it('Source filter narrows visible rows without re-fetching', async () => {
    render(<WorkflowListPage />);

    await screen.findByText('Tenant Campaign');

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(screen.getByText('Tenant Campaign')).toBeInTheDocument();
    expect(screen.queryByText('DM2 Adherence Watch')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Platform' }));
    expect(screen.queryByText('Tenant Campaign')).not.toBeInTheDocument();
    expect(screen.getByText('DM2 Adherence Watch')).toBeInTheDocument();

    // Filter is purely client-side; backend is fetched once.
    expect(listWorkflows).toHaveBeenCalledTimes(1);
    expect(listSystemWorkflows).toHaveBeenCalledTimes(1);
  });

  it('opens clone dialog and clones a system workflow', async () => {
    render(<WorkflowListPage />);

    await screen.findByRole('button', { name: 'Clone' });
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));

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

    await screen.findByText('Tenant Campaign');
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));

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

    await screen.findByText('Tenant Campaign');
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' }).at(-1)!);

    await waitFor(() => expect(archiveWorkflow).toHaveBeenCalledWith('wf-tenant'));
  });
});
