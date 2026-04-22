import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/types/auth.types';

/**
 * Mirrors backend `app.constants.SYSTEM_TENANT_ID`. Super-admin surfaces
 * (global pricing mutations, models.dev refresh) require the user to be
 * an Owner of this tenant.
 */
export const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export const USER_MANAGEMENT_PERMISSIONS = [
  'user:create',
  'user:edit',
  'user:deactivate',
  'user:delete',
  'user:reset_password',
  'invite_link:manage',
  'role:assign',
] as const;

export const ADMIN_ACCESS_PERMISSIONS = [
  ...USER_MANAGEMENT_PERMISSIONS,
  'schedule:manage',
] as const;

export function userHasPermission(user: User | null | undefined, permission: string): boolean {
  if (!user) return false;
  if (user.isOwner) return true;
  return user.permissions.includes(permission);
}

export function userHasAnyPermission(
  user: User | null | undefined,
  permissions: readonly string[],
): boolean {
  if (!user) return false;
  if (user.isOwner) return true;
  return permissions.some((permission) => user.permissions.includes(permission));
}

export function userHasAppAccess(user: User | null | undefined, appSlug: string): boolean {
  if (!user) return false;
  if (user.isOwner) return true;
  return user.appAccess.includes(appSlug);
}

/** Check permission from outside React (callbacks, services) */
export function hasPermission(permission: string): boolean {
  return userHasPermission(useAuthStore.getState().user, permission);
}

/** Check app access from outside React */
export function hasAppAccess(appSlug: string): boolean {
  return userHasAppAccess(useAuthStore.getState().user, appSlug);
}

/** React hook for permission check (reactive) */
export function usePermission(permission: string): boolean {
  return userHasPermission(useAuthStore((s) => s.user), permission);
}

/** React hook for app access check (reactive) */
export function useAppAccess(appSlug: string): boolean {
  return userHasAppAccess(useAuthStore((s) => s.user), appSlug);
}

export function isOwner(user: User | null | undefined): boolean {
  return !!user?.isOwner;
}

export function isSuperAdmin(user: User | null | undefined): boolean {
  return !!user?.isOwner && user.tenantId === SYSTEM_TENANT_ID;
}

/** Reactive hook — zero API calls, selector over `authStore` only. */
export function useIsOwner(): boolean {
  return useAuthStore((s) => !!s.user?.isOwner);
}

/** Reactive hook — zero API calls, selector over `authStore` only. */
export function useIsSuperAdmin(): boolean {
  return useAuthStore((s) => !!s.user?.isOwner && s.user.tenantId === SYSTEM_TENANT_ID);
}
