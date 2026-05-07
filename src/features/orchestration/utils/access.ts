import type { User } from '@/types/auth.types';
import { userHasPermission } from '@/utils/permissions';

export function canManageOrchestration(user: User | null | undefined): boolean {
  return userHasPermission(user, 'orchestration:manage');
}

export function canEditOrchestrationAsset(
  user: User | null | undefined,
  createdBy: string,
): boolean {
  if (!user) return false;
  if (!canManageOrchestration(user)) return false;
  return user.id === createdBy;
}
