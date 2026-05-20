import { apiRequest } from './client';

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  roleId: string;
  roleName: string;
  isOwner: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface CreateUserRequest {
  email: string;
  displayName: string;
  password: string;
  roleId: string;
}

export interface UpdateUserRequest {
  displayName?: string;
  roleId?: string;
  isActive?: boolean;
}

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
}

export interface TenantConfig {
  id: string;
  tenantId: string;
  appUrl: string | null;
  logoUrl: string | null;
  allowedDomains: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdateTenantConfigRequest {
  appUrl?: string | null;
  logoUrl?: string | null;
  allowedDomains?: string[];
}

export type InviteLinkStatus = 'active' | 'revoked' | 'expired' | 'exhausted';
export type InviteSignupMethod = 'password' | 'sso';
export type InviteListStatus = 'active' | 'terminal' | 'all';

export type InviteEmailStatus =
  | 'not_requested'
  | 'sent'
  | 'recipient_rejected'
  | 'not_configured'
  | 'failed';

export type InviteMailLogStatus = 'sent' | 'failed';

export interface InviteLink {
  id: string;
  label: string | null;
  roleId: string;
  maxUses: number | null;
  usesCount: number;
  expiresAt: string;
  status: InviteLinkStatus;
  signupMethod: InviteSignupMethod;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedByEmail: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByEmail: string;
  // Populated only when the caller requests ?include=latestSend.
  latestSendRecipient?: string | null;
  latestSendStatus?: InviteMailLogStatus | null;
  latestSendAt?: string | null;
}

export interface InviteLinkUse {
  id: string;
  userId: string | null;
  userEmail: string;
  usedAt: string;
  ipHashPrefix: string | null;
}

export interface CreateInviteLinkRequest {
  label?: string;
  roleId?: string;
  maxUses?: number | null;
  expiresInHours?: number;
  signupMethod?: InviteSignupMethod;
  /** When set, the platform emails the invite to this address and reports
   *  the outcome on the response's ``emailStatus`` field. */
  recipientEmail?: string;
  /** Optional greeting personalisation. Defaults to the email local part. */
  userName?: string;
}

export interface CreateInviteLinkResponse extends InviteLink {
  inviteUrl: string;
  emailStatus: InviteEmailStatus;
}

export const adminApi = {
  listUsers: (): Promise<AdminUser[]> =>
    apiRequest('/api/admin/users'),

  createUser: (data: CreateUserRequest): Promise<AdminUser> =>
    apiRequest('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateUser: (userId: string, data: UpdateUserRequest): Promise<AdminUser> =>
    apiRequest(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deactivateUser: (userId: string): Promise<void> =>
    apiRequest(`/api/admin/users/${userId}`, {
      method: 'DELETE',
    }),

  deleteUser: (userId: string): Promise<void> =>
    apiRequest(`/api/admin/users/${userId}/permanent`, {
      method: 'DELETE',
    }),

  resetUserPassword: (userId: string, newPassword: string): Promise<void> =>
    apiRequest(`/api/admin/users/${userId}/password`, {
      method: 'PUT',
      body: JSON.stringify({ newPassword }),
    }),

  getTenant: (): Promise<TenantInfo> =>
    apiRequest('/api/admin/tenant'),

  updateTenant: (data: { name: string }): Promise<TenantInfo> =>
    apiRequest('/api/admin/tenant', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Invite links
  createInviteLink: (data: CreateInviteLinkRequest): Promise<CreateInviteLinkResponse> =>
    apiRequest('/api/admin/invite-links', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listInviteLinks: (
    params?: { status?: InviteListStatus; include?: ('latestSend')[] },
  ): Promise<InviteLink[]> => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.include?.length) qs.set('include', params.include.join(','));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiRequest(`/api/admin/invite-links${suffix}`);
  },

  // Phase 2: revoke moves to POST /revoke. The server returns the updated
  // row so the caller can patch its cache without a follow-up GET.
  revokeInviteLink: (linkId: string): Promise<InviteLink> =>
    apiRequest(`/api/admin/invite-links/${linkId}/revoke`, {
      method: 'POST',
    }),

  // Forensic drill-in. Server already truncates the IP hash to 12 chars.
  listInviteUses: async (linkId: string): Promise<InviteLinkUse[]> => {
    const resp = await apiRequest<{ items: InviteLinkUse[] }>(
      `/api/admin/invite-links/${linkId}/uses`,
    );
    return resp.items;
  },

  // Hard delete is gated by `invite_link:delete` (default-off, owner only).
  // Phase 4: now on the canonical DELETE verb. Surface deliberately not
  // exposed in the standard admin UI yet.
  hardDeleteInviteLink: (linkId: string): Promise<void> =>
    apiRequest(`/api/admin/invite-links/${linkId}`, {
      method: 'DELETE',
    }),

  // Tenant config
  getTenantConfig: (): Promise<TenantConfig> =>
    apiRequest('/api/admin/tenant-config'),

  updateTenantConfig: (data: UpdateTenantConfigRequest): Promise<TenantConfig> =>
    apiRequest('/api/admin/tenant-config', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};
