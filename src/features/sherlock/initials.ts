/** Initials for the user avatar from a display name. */
export function getUserInitials(displayName?: string): string {
  if (!displayName) return '?';
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}
