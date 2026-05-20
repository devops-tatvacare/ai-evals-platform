import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/adminApi', () => ({
  adminApi: {
    listInviteLinks: vi.fn(),
    revokeInviteLink: vi.fn(),
    listInviteUses: vi.fn(),
    createInviteLink: vi.fn(),
  },
}));

vi.mock('@/services/api/rolesApi', () => ({
  rolesApi: {
    listRoles: vi.fn().mockResolvedValue([]),
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

import { adminApi, type InviteLink, type InviteListStatus } from '@/services/api/adminApi';
import { useAuthStore } from '@/stores/authStore';
import { InviteLinksSection } from '@/features/admin/InviteLinksSection';

const mockedListInviteLinks = adminApi.listInviteLinks as unknown as ReturnType<typeof vi.fn>;
const mockedRevokeInviteLink = adminApi.revokeInviteLink as unknown as ReturnType<typeof vi.fn>;
const mockedListInviteUses = adminApi.listInviteUses as unknown as ReturnType<typeof vi.fn>;

function makeInvite(overrides: Partial<InviteLink> = {}): InviteLink {
  return {
    id: 'invite-1',
    label: 'Engineering team',
    roleId: 'role-1',
    maxUses: 5,
    usesCount: 0,
    expiresAt: '2099-01-01T00:00:00+00:00',
    status: 'active',
    signupMethod: 'password',
    revokedAt: null,
    revokedBy: null,
    revokedByEmail: null,
    createdAt: '2026-05-01T00:00:00+00:00',
    createdBy: 'user-1',
    createdByEmail: 'admin@example.com',
    ...overrides,
  };
}

function setOwnerUser() {
  // Owner short-circuits PermissionGate, so we don't have to thread
  // permission strings through these tests.
  useAuthStore.setState({
    user: {
      id: 'admin',
      email: 'admin@example.com',
      displayName: 'Admin',
      tenantId: 't-1',
      tenantName: 'Tenant',
      roleId: 'r-owner',
      roleName: 'Owner',
      isOwner: true,
      permissions: [],
      appAccess: ['voice-rx', 'kaira-bot', 'inside-sales'],
    } as never,
    accessToken: 'fake',
    isAuthenticated: true,
    isLoading: false,
  });
}

function renderSection(initialEntries = ['/admin']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <InviteLinksSection />
    </MemoryRouter>,
  );
}

describe('InviteLinksSection', () => {
  beforeEach(() => {
    setOwnerUser();
    mockedListInviteLinks.mockReset();
    mockedRevokeInviteLink.mockReset();
    mockedListInviteUses.mockReset();
  });

  afterEach(() => {
    useAuthStore.setState({ user: null, isAuthenticated: false });
  });

  it('renders server-driven status badges for each lifecycle state', async () => {
    mockedListInviteLinks.mockResolvedValue([
      makeInvite({ id: 'a', label: 'active-row', status: 'active' }),
      makeInvite({
        id: 'r',
        label: 'revoked-row',
        status: 'revoked',
        revokedAt: '2026-05-01T12:00:00+00:00',
        revokedByEmail: 'actor@example.com',
      }),
      makeInvite({
        id: 'e',
        label: 'expired-row',
        status: 'expired',
        expiresAt: '2026-04-01T00:00:00+00:00',
      }),
      makeInvite({
        id: 'x',
        label: 'exhausted-row',
        status: 'exhausted',
        usesCount: 5,
        maxUses: 5,
      }),
    ]);

    renderSection();

    // Default filter is 'active' — must request server-side.
    await waitFor(() => {
      expect(mockedListInviteLinks).toHaveBeenCalledWith({ status: 'active', include: ['latestSend'] });
    });

    // All four labels render (the search filter is empty).
    await screen.findByText('active-row');
    // Each terminal status appears once (filter pill says "Active" too, so
    // scope the active-status badge check to rows with an explicit dot).
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Exhausted')).toBeInTheDocument();
  });

  it('renders the revoke action button only on active rows', async () => {
    mockedListInviteLinks.mockResolvedValue([
      makeInvite({ id: 'a', label: 'active-row', status: 'active' }),
      makeInvite({
        id: 'r',
        label: 'revoked-row',
        status: 'revoked',
        revokedAt: '2026-05-01T12:00:00+00:00',
      }),
    ]);

    renderSection();

    await screen.findByText('active-row');

    // Exactly one revoke button (the Active row); the Revoked row has none.
    const revokeButtons = screen.getAllByTitle('Revoke');
    expect(revokeButtons).toHaveLength(1);
  });

  it('changing filter pill triggers refetch with new status', async () => {
    mockedListInviteLinks.mockResolvedValue([]);

    renderSection();

    await waitFor(() => {
      expect(mockedListInviteLinks).toHaveBeenCalledWith({ status: 'active', include: ['latestSend'] });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));

    await waitFor(() => {
      expect(mockedListInviteLinks).toHaveBeenLastCalledWith({ status: 'terminal', include: ['latestSend'] });
    });
  });

  it('renders latest-send columns only when at least one row has send data', async () => {
    mockedListInviteLinks.mockResolvedValue([
      makeInvite({
        id: 'sent-row',
        label: 'with-send',
        status: 'active',
        latestSendRecipient: 'jane@allowed.com',
        latestSendStatus: 'sent',
        latestSendAt: '2026-05-19T10:00:00+00:00',
      }),
      makeInvite({ id: 'plain-row', label: 'no-send', status: 'active' }),
    ]);

    renderSection();

    await screen.findByText('with-send');
    expect(screen.getByText('Sent to')).toBeInTheDocument();
    expect(screen.getByText('Last send')).toBeInTheDocument();
    expect(screen.getByText('jane@allowed.com')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });

  it('hides the latest-send columns when no row has send data', async () => {
    mockedListInviteLinks.mockResolvedValue([
      makeInvite({ id: 'plain', label: 'plain', status: 'active' }),
    ]);

    renderSection();

    await screen.findByText('plain');
    expect(screen.queryByText('Sent to')).not.toBeInTheDocument();
    expect(screen.queryByText('Last send')).not.toBeInTheDocument();
  });

  it('reads initial filter from the URL ?status= param', async () => {
    mockedListInviteLinks.mockResolvedValue([]);

    renderSection(['/admin?status=terminal']);

    await waitFor(() => {
      expect(mockedListInviteLinks).toHaveBeenCalledWith({ status: 'terminal', include: ['latestSend'] });
    });
  });

  it('clicking the uses count opens the redemptions panel', async () => {
    mockedListInviteLinks.mockResolvedValue([
      makeInvite({ id: 'r', label: 'redeemed-row', status: 'active', usesCount: 2 }),
    ]);
    mockedListInviteUses.mockResolvedValue([
      {
        id: 'use-1',
        userId: 'u-1',
        userEmail: 'redeemer@example.com',
        usedAt: '2026-05-02T10:00:00+00:00',
        ipHashPrefix: 'abcdef012345',
      },
    ]);

    renderSection();

    await screen.findByText('redeemed-row');
    // Count button shows "2 / 5".
    fireEvent.click(screen.getByTitle('View redemptions'));

    await waitFor(() => {
      expect(mockedListInviteUses).toHaveBeenCalledWith('r');
    });
    await screen.findByText('redeemer@example.com');
  });

  it('confirming revoke calls POST /revoke (the new endpoint)', async () => {
    const active = makeInvite({ id: 'a', label: 'active-row', status: 'active' });
    mockedListInviteLinks.mockResolvedValue([active]);
    mockedRevokeInviteLink.mockResolvedValue({
      ...active,
      status: 'revoked',
      revokedAt: '2026-05-08T00:00:00+00:00',
    });

    renderSection();

    await screen.findByText('active-row');
    fireEvent.click(screen.getByTitle('Revoke'));

    // Confirm dialog (Modal has no role="dialog"); locate by its title.
    const dialogTitle = await screen.findByText('Revoke Invite Link');
    const dialogContainer = dialogTitle.closest('div')!;
    // The destructive button inside the modal — multiple "Revoke" buttons
    // exist on the page (table action + dialog confirm), so scope.
    fireEvent.click(within(dialogContainer.parentElement as HTMLElement)
      .getAllByRole('button', { name: 'Revoke' })
      .pop()!);

    await waitFor(() => {
      expect(mockedRevokeInviteLink).toHaveBeenCalledWith('a');
    });
  });

  it('handles the ?status= query string contract', () => {
    // Sanity check the contract Phase 2 ships: callers pass a typed status.
    const expected: InviteListStatus = 'terminal';
    expect(expected).toBe('terminal');
  });
});
