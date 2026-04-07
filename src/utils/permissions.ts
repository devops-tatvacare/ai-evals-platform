import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/types/auth.types';

export const ADMIN_ACCESS_PERMISSIONS = [
  'user:create',
  'user:edit',
  'user:deactivate',
  'user:delete',
  'user:reset_password',
  'invite_link:manage',
  'role:assign',
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
