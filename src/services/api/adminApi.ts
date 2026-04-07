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

export interface InviteLink {
  id: string;
  label: string | null;
  roleId: string;
  maxUses: number | null;
  usesCount: number;
  expiresAt: string;
  isActive: boolean;
  createdAt: string;
  createdByEmail: string;
}

export interface CreateInviteLinkRequest {
  label?: string;
  roleId?: string;
  maxUses?: number | null;
  expiresInHours?: number;
}

export interface CreateInviteLinkResponse extends InviteLink {
  inviteUrl: string;
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

  listInviteLinks: (): Promise<InviteLink[]> =>
    apiRequest('/api/admin/invite-links'),

  revokeInviteLink: (linkId: string): Promise<void> =>
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
