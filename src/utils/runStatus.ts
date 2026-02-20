/**
 * Whether a run/job status represents an in-progress state
 * that should trigger polling.
 */
export function isActiveStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'running' || s === 'pending';
}
