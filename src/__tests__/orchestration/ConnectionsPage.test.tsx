import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/orchestrationConnections', () => ({
  archiveConnection: vi.fn(),
  listConnections: vi.fn(),
  rotateWebhookToken: vi.fn(),
  testConnection: vi.fn(),
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
      title: 'Connections',
    }),
  };
});

import { listConnections } from '@/services/api/orchestrationConnections';
import { ConnectionsPage } from '@/features/admin/integrations/ConnectionsPage';
import { useAppStore } from '@/stores/appStore';

const mockedListConnections = listConnections as ReturnType<typeof vi.fn>;

describe('ConnectionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ currentApp: 'inside-sales' });
    mockedListConnections.mockResolvedValue([
      {
        id: 'conn-1',
        tenantId: 'tenant-1',
        appId: 'inside-sales',
        provider: 'wati',
        name: 'WATI Production',
        active: true,
        lastUsedAt: null,
        webhookUrl: null,
        configRedacted: {},
        fields: [],
        createdBy: 'user-1',
        createdAt: '2026-05-04T10:00:00Z',
        updatedAt: '2026-05-04T10:00:00Z',
      },
    ]);
  });

  it('renders provider labels through the shared formatter instead of raw keys', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/integrations?app=inside-sales']}>
        <ConnectionsPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(mockedListConnections).toHaveBeenCalledWith({
        appId: 'inside-sales',
        includeInactive: true,
        visibility: 'all',
      }),
    );

    expect(await screen.findByText('WATI Production')).toBeInTheDocument();
    expect(screen.getByText('WATI (WhatsApp)')).toBeInTheDocument();
  });
});
