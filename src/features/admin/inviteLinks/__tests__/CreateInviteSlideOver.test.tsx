import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/notifications', () => ({
  notificationService: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

import { notificationService } from '@/services/notifications';
import type {
  CreateInviteLinkRequest,
  CreateInviteLinkResponse,
  InviteEmailStatus,
} from '@/services/api/adminApi';
import type { RoleResponse } from '@/services/api/rolesApi';

import { CreateInviteSlideOver } from '../CreateInviteSlideOver';

const ROLES: RoleResponse[] = [
  // RoleResponse is broader than this; we cast to satisfy the prop type while
  // keeping the test fixture small. The slide-over only reads {id, name}.
  { id: 'role-1', name: 'Member' } as unknown as RoleResponse,
  { id: 'role-2', name: 'Admin' } as unknown as RoleResponse,
];

function makeResponse(
  overrides: Partial<CreateInviteLinkResponse> = {},
): CreateInviteLinkResponse {
  return {
    id: 'invite-1',
    label: null,
    roleId: 'role-1',
    maxUses: null,
    usesCount: 0,
    expiresAt: '2099-01-01T00:00:00+00:00',
    status: 'active',
    signupMethod: 'password',
    revokedAt: null,
    revokedBy: null,
    revokedByEmail: null,
    createdAt: '2026-05-19T00:00:00+00:00',
    createdBy: 'admin-1',
    createdByEmail: 'admin@example.com',
    inviteUrl: 'https://example.test/signup?invite=tok',
    emailStatus: 'not_requested',
    ...overrides,
  };
}

type CreateInviteFn = (body: CreateInviteLinkRequest) => Promise<CreateInviteLinkResponse>;

interface RenderOptions {
  emailStatus?: InviteEmailStatus;
  createInvite?: CreateInviteFn;
  onCreated?: (result: CreateInviteLinkResponse) => void;
  allowedDomains?: string[];
}

function renderSlideOver(opts: RenderOptions = {}) {
  const createInvite: CreateInviteFn =
    opts.createInvite ??
    (async () => makeResponse({ emailStatus: opts.emailStatus ?? 'not_requested' }));
  const onClose = vi.fn();
  const onCreated = opts.onCreated ?? vi.fn();
  const createInviteSpy = vi.fn(createInvite) as ReturnType<typeof vi.fn> &
    CreateInviteFn;

  render(
    <CreateInviteSlideOver
      isOpen
      onClose={onClose}
      roles={ROLES}
      allowedDomains={opts.allowedDomains ?? []}
      createInvite={createInviteSpy}
      onCreated={onCreated}
    />,
  );
  return { createInvite: createInviteSpy, onClose, onCreated };
}

beforeEach(() => {
  vi.mocked(notificationService.success).mockReset();
  vi.mocked(notificationService.error).mockReset();
  vi.mocked(notificationService.warning).mockReset();
  vi.mocked(notificationService.info).mockReset();
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CreateInviteSlideOver', () => {
  it('submits without recipientEmail when the field is left blank', async () => {
    const { createInvite, onClose } = renderSlideOver();

    fireEvent.click(screen.getByRole('button', { name: /generate invite link/i }));

    await waitFor(
      () => expect(createInvite).toHaveBeenCalledTimes(1),
      { timeout: 15000 },
    );
    const body = createInvite.mock.calls[0][0] as CreateInviteLinkRequest;
    expect(body.recipientEmail).toBeUndefined();
    expect(body.userName).toBeUndefined();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  }, 20000);

  it('shows success toast when emailStatus is "sent"', async () => {
    const { createInvite } = renderSlideOver({ emailStatus: 'sent' });
    fireEvent.change(screen.getByPlaceholderText(/recipient@company.com/i), {
      target: { value: 'jane@allowed.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate invite link/i }));

    await waitFor(() => expect(createInvite).toHaveBeenCalled());
    const body = createInvite.mock.calls[0][0] as CreateInviteLinkRequest;
    expect(body.recipientEmail).toBe('jane@allowed.com');
    await waitFor(() =>
      expect(notificationService.success).toHaveBeenCalledWith(
        expect.stringMatching(/emailed/i),
      ),
    );
  });

  it('shows inline error for invalid email format and does not call the API', async () => {
    const { createInvite } = renderSlideOver();
    fireEvent.change(screen.getByPlaceholderText(/recipient@company.com/i), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate invite link/i }));

    await waitFor(() =>
      expect(screen.getByText(/valid email/i)).toBeInTheDocument(),
    );
    expect(createInvite).not.toHaveBeenCalled();
  });

  it('warns + copies the link when emailStatus is "not_configured"', async () => {
    renderSlideOver({ emailStatus: 'not_configured' });
    fireEvent.change(screen.getByPlaceholderText(/recipient@company.com/i), {
      target: { value: 'jane@allowed.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate invite link/i }));

    await waitFor(() =>
      expect(notificationService.warning).toHaveBeenCalledWith(
        expect.stringMatching(/not configured/i),
      ),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://example.test/signup?invite=tok',
    );
  });

  it('errors + copies the link when emailStatus is "recipient_rejected"', async () => {
    renderSlideOver({ emailStatus: 'recipient_rejected' });
    fireEvent.change(screen.getByPlaceholderText(/recipient@company.com/i), {
      target: { value: 'jane@blocked.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate invite link/i }));

    await waitFor(() =>
      expect(notificationService.error).toHaveBeenCalledWith(
        expect.stringMatching(/domain is not allowed/i),
      ),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://example.test/signup?invite=tok',
    );
  });

  it('coerces blank recipientEmail to undefined (defensive Zod transform)', async () => {
    const { createInvite } = renderSlideOver();
    fireEvent.change(screen.getByPlaceholderText(/recipient@company.com/i), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate invite link/i }));

    await waitFor(
      () => expect(createInvite).toHaveBeenCalled(),
      { timeout: 15000 },
    );
    const body = createInvite.mock.calls[0][0] as CreateInviteLinkRequest;
    expect(body.recipientEmail).toBeUndefined();
  }, 20000);

  it('renders informational domain hint when allowed-domains do not match', async () => {
    renderSlideOver({ allowedDomains: ['@allowed.com'] });
    fireEvent.change(screen.getByPlaceholderText(/recipient@company.com/i), {
      target: { value: 'jane@blocked.com' },
    });

    await waitFor(() =>
      expect(screen.getByText(/may not be allowed/i)).toBeInTheDocument(),
    );
  });
});
